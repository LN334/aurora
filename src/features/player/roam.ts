import { songsAcrossPlatforms } from '../online/artist-merge'
import { loadPlatformDaily } from '../online/daily'
import { loadPlatformLiked } from '../online/platform-liked'
import { getProvider, listAvailableProviders } from '../online/registry'
import { useOnlineStore, type PlatformBackend } from '../online/store'
import type { ProviderId } from '../online/types'
import { mergeVersions, trackKey } from '../online/unify'
import { rankBySeed } from './roam-pure'
import { sourceOrder } from '../settings/source-order'
import { useLibrary } from '../library/store'
import { useHistory } from './history-store'
import type { Track } from '../../types'
import { SLOTS } from '../online/slots'

interface RoamPool {
  /** 池子里所有的歌，同曲多版本已并成一行。 */
  tracks: Track[]
  /** 池子里不在「我的」里的那部分：平台推过来、还没收藏过的。 */
  freshTracks: Track[]
}

/**
 * 漫游池：平台每天推的，混上我有的。
 *
 * 只有「我有的」不算漫游——那些歌本来就在列表里，随机一遍只是换个顺序，听两
 * 次就腻了。所以先要各平台的推荐（每日推荐 + 私人漫游），再把本机、最近听过、
 * 收藏进来的一起并上。同一首在推荐与收藏里都出现时，`mergeVersions` 并成一行，
 * 不会因为「今天推了」就多出一份。
 */
/**
 * 池子。`platforms` 是用户勾的推流平台，空数组表示一家都没勾。
 */
export async function loadRoamPool(platforms?: ProviderId[]): Promise<RoamPool> {
  const order = sourceOrder()
  const local = useLibrary.getState().tracks
  const recent = useHistory
    .getState()
    .history.recent.flatMap((entry) => (entry.track ? [entry.track] : []))
  const [liked, daily, stream] = await Promise.all([
    loadPlatformLiked().catch(() => [] as Track[]),
    loadPlatformDaily(platforms).catch(() => [] as Track[]),
    loadRoamStream(SLOTS.roam, platforms).catch(() => [] as Track[])
  ])

  const mine = mergeVersions([...local, ...recent, ...liked], order)
  const pushed = mergeVersions([...daily, ...stream], order)
  const tracks = mergeVersions([...pushed, ...mine], order)
  const known = new Set(mine.map((track) => trackKey(track)))
  return { tracks, freshTracks: tracks.filter((track) => !known.has(trackKey(track))) }
}

/**
 * 种子那首的同艺人专辑歌，去所有能搜的平台要一遍。
 *
 * 「从这首出发」如果只拿平台今天推的那几十首重排，多半一首同艺人都没有——推荐
 * 是泛的，不会因为你想听这个人就变成他的专场。所以要主动搜一次：艺人名精确匹配，
 * 拿这个人的歌来当这一趟的骨架，平台推的那些退到后面当补充。
 */
export async function loadSeedTracks(seed: Track, platforms?: ProviderId[]): Promise<Track[]> {
  const artist = seed.artist.trim()
  if (!artist) return []
  const only = platforms === undefined ? undefined : new Set<string>(platforms)
  return songsAcrossPlatforms(artist, sourceOrder(), undefined, only).catch(() => [])
}

/**
 * 从池子里挑这一趟要放的几十首。
 *
 * 只放平台推过来的：收藏过的、听过的、本机有的都不进来。漫游是一份「今天可能
 * 没听过」的流，掺一半旧歌就还是那批歌换个顺序，听两次就腻了。池子里的旧歌只
 * 用来判断哪些是新的。
 */
export function buildRoamQueue(
  pool: RoamPool,
  size: number = SLOTS.roam,
  seed?: Track
): Track[] {
  const fresh = shuffle(pool.freshTracks)
  if (!seed) return fresh.slice(0, size)
  /*
   * 种子那首往往不在 freshTracks 里——它是用户手上的歌，而这一份只装「没收藏
   * 过的」。所以把它单独塞回去并排第一，再按关系往外扩散；池子里万一也有它
   * （平台今天正好推了这首），按 trackKey 去掉，免得这一趟放两遍。
   */
  const key = trackKey(seed)
  const rest = fresh.filter((track) => trackKey(track) !== key)
  return rankBySeed([seed, ...rest], seed).slice(0, size)
}

/**
 * Fisher–Yates。不改原数组：池子挂在 state 上，就地打乱会让同一个引用被改两次，
 * React 认不出变化，页面上的顺序和实际播放顺序会对不上。
 */

/**
 * 一批「还没听过的」，朝 SLOTS.roam 这个总量走。
 *
 * 原生客户端的漫游是一条流，不是一份列表：听到底就再要一批。这里把这件事做成
 * 一次请求——先问平台的私人漫游（网易云有 `personalFm`），没有这个接口的退回
 * 它的每日推荐。
 *
 * 早年每家固定取 12 首，于是「这一批有多少」跟着勾选平台数变：勾一家 12 首、
 * 勾四家 48 首。现在把总量摊到各家，再对同一家问几轮（私人漫游一次只回几首，
 * 每日推荐一次给几十首），关掉一家不会让这一批少一截。
 */
export async function loadRoamStream(
  total: number = SLOTS.roam,
  platforms?: ProviderId[]
): Promise<Track[]> {
  const wanted = platforms === undefined ? null : new Set(platforms)
  const providers = listAvailableProviders().filter(
    (provider) =>
      Boolean(provider.recommendations?.personalFm || provider.recommendations?.dailySongs) &&
      (wanted === null || wanted.has(provider.id))
  )
  if (providers.length === 0) return []

  /* 至少问 6 首：personalFm 一次给得少，摊到每家只剩一两首时问不出东西。 */
  const per = Math.max(6, Math.ceil(total / providers.length))
  const ROUNDS = 3
  const lists = await Promise.all(
    providers.map(async (provider) => {
      const out: Track[] = []
      const seen = new Set<string>()
      for (let round = 0; round < ROUNDS && out.length < per; round += 1) {
        const chunk = await fetchStream(provider, per)
        for (const track of chunk) {
          const key = trackKey(track)
          if (seen.has(key)) continue
          seen.add(key)
          out.push(track)
        }
      }
      return out.slice(0, per)
    })
  )

  return mergeVersions(lists.flat(), sourceOrder())
}

/** 一家的下一批：私人漫游优先，没有就退回每日推荐。失败当这家没给。 */
async function fetchStream(
  provider: ReturnType<typeof listAvailableProviders>[number],
  limit: number
): Promise<Track[]> {
  try {
    // 绑定档案在 init 里，跳过它上游会当游客。
    await useOnlineStore(provider.id as never)
      .getState()
      .init()
      .catch(() => {})
    const backend =
      (getProvider(provider.id as ProviderId)?.backend as PlatformBackend | undefined) ?? null
    const api = provider.recommendations
    if (!backend || !api) return []
    const songs = api.personalFm
      ? await api.personalFm(limit)
      : await (api.dailySongs?.() ?? Promise.resolve([]))
    return (songs ?? []).slice(0, limit).map((song) => backend.toTrack(song))
  } catch {
    return []
  }
}

export function shuffle<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}
