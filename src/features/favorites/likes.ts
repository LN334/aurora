import { useMemo } from 'react'
import { create } from 'zustand'
import type { Track } from '../../types'
import type { PlatformBackend } from '../online/store'
import { getProvider, listProviders } from '../online/registry'
import type { OnlineMusicProvider } from '../online/types'
import { useFavorites } from './store'
import { applyLiked, likeSourceOf } from './like-source'
import type { LikeSource } from './like-source'

/**
 * 喜欢：一个动作，两个落点。
 *
 * 本地文件写进本机收藏（`favorites/store.ts`，磁盘持久化）；在线歌写进平台
 * 账号（主进程 → 上游）。界面只认识「喜欢/取消喜欢」，不该知道一首歌是被文件
 * 还是被平台记住的——所以判断在这里做，页面拿到的只是结果。
 *
 * 这个模块只缓存**在线**的那一半：本地的已喜欢列表是 `useFavorites` 的事实，
 * 再复制一份就会有两个真相。
 */

export type { LikeSource }

/** 一个来源的加载状态。`anonymous` 和 `error` 分开，是因为一个该提示登录、一个该提示重试。 */
export type LikeSourceState = 'idle' | 'loading' | 'ready' | 'anonymous' | 'error'

export interface LikeSourceSlice {
  tracks: Track[]
  state: LikeSourceState
  error: string | null
}

export interface LikeToggleResult {
  ok: boolean
  /** 操作后是否处于「已喜欢」。 */
  liked: boolean
  /** 失败时给用户看的一句话；界面据此弹提示，不允许静默失败。 */
  message?: string
}

interface LikesState {
  sources: Record<string, LikeSourceSlice>
  /** force 为真时忽略「已就绪」，手动刷新走这条。 */
  refresh(source: LikeSource, force?: boolean): Promise<void>
  refreshAll(force?: boolean): Promise<void>
  toggle(track: Track): Promise<LikeToggleResult>
  /**
   * 把别处已经拉到的平台喜欢交进来。
   *
   * 「我喜欢的」页走的是自己的缓存（`online/platform-liked.ts`），而心形按钮读的
   * 是这里。不交进来，同一页会出现「列表里有这首歌、心却是空的」——两套缓存
   * 各拉各的时候，心标亮不亮取决于用户先去过哪个页面。
   */
  seed(source: LikeSource, tracks: Track[]): void
}

const emptySlice = (state: LikeSourceState, error: string | null = null): LikeSourceSlice => ({
  tracks: [],
  state,
  error
})

function backendOf(provider: OnlineMusicProvider | null): PlatformBackend | null {
  return provider?.backend ? (provider.backend as PlatformBackend) : null
}

/** 有读、有写、且此刻可用的平台。收藏页的来源筛选和「全部刷新」都读它。 */
export function likeProviders(): OnlineMusicProvider[] {
  return listProviders().filter(
    (provider) => provider.available() && provider.capabilities.likes && Boolean(provider.likes)
  )
}

/** 来源的显示名：本机，或平台的短名。 */
export function likeSourceName(source: LikeSource): string {
  if (source === 'local') return '本机'
  const provider = getProvider(source)
  return provider?.shortName ?? provider?.displayName ?? source
}

export const useLikes = create<LikesState>()((set, get) => ({
  sources: {},

  async refresh(source, force = false) {
    // 本地的真相在 useFavorites 里，这里没有可拉的。
    if (source === 'local') return
    const provider = getProvider(source)
    const backend = backendOf(provider)
    if (!provider?.likes || !backend) return

    /*
     * 收藏页每次进入都会调一次；已拉到的来源不必再走一趟网络。未登录/失败
     * 的仍然重试——那两种状态本来就是「这次没成」。
     */
    const known = get().sources[source]?.state
    if (!force && (known === 'ready' || known === 'loading')) return

    set((state) => ({
      sources: { ...state.sources, [source]: { ...(state.sources[source] ?? emptySlice('idle')), state: 'loading', error: null } }
    }))

    try {
      /*
       * 先问登录。平台的喜欢列表在未登录时返回空数组，和「一条都没喜欢」长得
       * 一模一样；不查这一步，收藏页会把「没登录」说成「你还没喜欢过」。
       */
      const account = provider.auth ? await provider.auth.loginStatus().catch(() => null) : null
      if (!account) {
        set((state) => ({ sources: { ...state.sources, [source]: emptySlice('anonymous') } }))
        return
      }
      const songs = await provider.likes.list()
      const tracks = songs.map((song) => backend.toTrack(song))
      set((state) => ({ sources: { ...state.sources, [source]: { tracks, state: 'ready', error: null } } }))
    } catch {
      set((state) => ({ sources: { ...state.sources, [source]: emptySlice('error', '拉取喜欢的歌失败，稍后再试') } }))
    }
  },

  async refreshAll(force = false) {
    await Promise.all(likeProviders().map((provider) => get().refresh(provider.id, force)))
  },

  seed(source, tracks) {
    if (source === 'local') return
    set((state) => ({
      sources: { ...state.sources, [source]: { tracks, state: 'ready', error: null } }
    }))
  },

  async toggle(track) {
    const source = likeSourceOf(track)

    if (source === 'local') {
      const liked = useFavorites.getState().toggle(track)
      return { ok: true, liked }
    }

    const provider = getProvider(source)
    const backend = backendOf(provider)
    if (!provider?.likes || !backend) {
      return { ok: false, liked: false, message: '这个平台还不支持喜欢' }
    }

    const songId = backend.songIdOf(track)
    if (!songId) {
      return { ok: false, liked: false, message: '这首歌没有可用的平台编号，喜欢不了' }
    }

    const previous = get().sources[source]?.tracks ?? []
    const already = previous.some((row) => row.id === track.id)
    const next = !already

    /*
     * 先改界面再发请求。心形按钮是逐行点的小动作，等一趟网络才变色会让人以为
     * 没点上、于是再点一次——两次请求互相抵消。失败时下面整段回滚。
     */
    set((state) => ({
      sources: {
        ...state.sources,
        [source]: {
          tracks: applyLiked(previous, track, next),
          state: 'ready',
          error: null
        }
      }
    }))

    let written = false
    try {
      written = await provider.likes.set(songId, next)
    } catch {
      written = false
    }
    if (written) return { ok: true, liked: next }

    set((state) => ({
      sources: { ...state.sources, [source]: { ...(state.sources[source] ?? emptySlice('ready')), tracks: previous } }
    }))

    const signedIn = provider.auth ? await provider.auth.loginStatus().catch(() => null) : null
    const name = provider.shortName ?? provider.displayName
    return {
      ok: false,
      liked: already,
      message: signedIn ? '没能保存喜欢，稍后再试' : `登录${name}后才能喜欢这首歌`
    }
  }
}))

/**
 * 每个来源各自喜欢了哪些 id。
 *
 * 与 `useLikedIds`（所有来源并成一个集合）不同，这张表保留「谁点的」：一行
 * 里挂着网易云与 QQ 两个版本时，徽章上要能分别看出哪家点过心、哪家没有。
 * 逐行各查一次 store 会让每次渲染做 N 次订阅，所以在这里一次算完，行只读
 * Map。
 */
export function useLikeMarks(): ReadonlyMap<LikeSource, ReadonlySet<string>> {
  const liked = useFavorites((state) => state.liked)
  const sources = useLikes((state) => state.sources)
  return useMemo(() => {
    const marks = new Map<LikeSource, Set<string>>()
    marks.set('local', new Set(liked.map((entry) => entry.id)))
    for (const [source, slice] of Object.entries(sources)) {
      marks.set(source, new Set(slice.tracks.map((row) => row.id)))
    }
    return marks
  }, [liked, sources])
}

/**
 * 这一行里，哪几个来源已经喜欢了。
 *
 * 只认「这一版自己的来源」——主行是网易云、挂着的 QQ 版本点过心时说 QQ，
 * 不能因为主行亮着就把标签算到别的平台头上。
 */
export function likedSourcesOf(
  track: Track,
  marks: ReadonlyMap<LikeSource, ReadonlySet<string>>
): LikeSource[] {
  const out: LikeSource[] = []
  const seen = new Set<LikeSource>()
  for (const version of [track, ...(track.versions ?? [])]) {
    const source = likeSourceOf(version)
    if (seen.has(source)) continue
    seen.add(source)
    if (marks.get(source)?.has(version.id)) out.push(source)
  }
  return out
}

/*
 * 已喜欢的全部 id：本地收藏 + 每个在线来源缓存的那一份。
 *
 * 列表行要在一处判断「这一行亮不亮心」，逐行各查一个 store 会让每次渲染做
 * N 次订阅；这里一次算完，行只读集合。
 */
export function useLikedIds(): ReadonlySet<string> {
  const marks = useLikeMarks()
  return useMemo(() => {
    const ids = new Set<string>()
    for (const set of marks.values()) {
      for (const id of set) ids.add(id)
    }
    return ids
  }, [marks])
}

/** 喜欢/取消喜欢。返回值里带着失败原因，由调用方决定怎么提示。 */
export function toggleLiked(track: Track): Promise<LikeToggleResult> {
  return useLikes.getState().toggle(track)
}

/** 某首歌现在是不是「已喜欢」。本地的读本地，在线的读缓存。 */
export function useLiked(track: Track | null | undefined): boolean {
  const source = likeSourceOf(track)
  const localLiked = useFavorites((state) =>
    track ? state.liked.some((entry) => entry.id === track.id) : false
  )
  const remoteLiked = useLikes((state) => {
    if (!track || source === 'local') return false
    return Boolean(state.sources[source]?.tracks.some((row) => row.id === track.id))
  })
  return source === 'local' ? localLiked : remoteLiked
}
