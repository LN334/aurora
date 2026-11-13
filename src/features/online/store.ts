import { create } from 'zustand'
import type { Track } from '../../types'
import { showFlash } from '../../ui/flash'
import { useAccounts } from '../accounts/store'
import { player } from '../player/actions'
import { getProvider, providerSupports } from './registry'
import {
  DEFAULT_QUALITY,
  RECOVER_WINDOW_MS,
  cachedFailure,
  cachedStream,
  clearStreams,
  dedupe,
  rememberFailure,
  rememberStream
} from './streams'
import {
  failureText,
  isQualityFallback,
  streamSummary,
  type OnlineAccount,
  type OnlineAlbumRef,
  type OnlineArtistRef,
  type OnlineCollectionKind,
  type OnlinePlaylistSummary,
  type OnlineSearchKind,
  type OnlineSong,
  type OnlineStream,
  type PlaylistOwnership,
  type ProviderId,
  type QualityTier
} from './types'

/**
 * One state machine for every online platform.
 *
 * Without this file each platform would need its own copy of: search with a
 * stale-response guard, a catalogue cache, a stream cache with retries, an account,
 * and a failure that is classified rather than printed. That duplication is what
 * the provider layer exists to remove, so the *behaviour* lives here once and each
 * platform supplies a `PlatformBackend` - a handful of small functions.
 *
 * What stays platform-specific on purpose: how a song becomes a `Track` (the id
 * prefix is the platform's), which collections it offers, and its own login
 * dialog. Those differ for real reasons, and abstracting them further would buy a
 * framework rather than remove repetition.
 */

export interface PlatformFail {
  reason: string
  message: string
  /** Song id when the failure is about one track, null when it is global. */
  songId: number | null
  at: number
}

 interface PlatformSearchResult {
  songs: OnlineSong[]
  albums: OnlineAlbumRef[]
  artists: OnlineArtistRef[]
}

/** What a platform must provide. Everything the interface does is derived from it. */
export interface PlatformBackend {
  id: ProviderId
  /** The platform's name, for failure sentences that have to name it. */
  displayName: string

  /** The upstream tier in use. Owned by the main process, never by this store. */
  getQuality(): Promise<QualityTier>
  setQuality(quality: QualityTier): Promise<QualityTier>

  search(keywords: string, kind: OnlineSearchKind, limit: number): Promise<PlatformSearchResult>

  streamUrl(
    songId: number,
    quality: QualityTier
  ): Promise<{ ok: true; stream: OnlineStream } | { ok: false; reason: string; message?: string }>

  /**
   * Resolve one song's record by id.
   *
   * Needed because the engine can ask for a URL for a track that is in the queue
   * but not in any list on screen (a restored queue, a queue built from a playlist
   * the user has since left). Returning null is a real answer: the store then says
   * nothing rather than guessing.
   */
  songById(songId: number): Promise<OnlineSong | null>

  /** A `Track` for this song: its id prefix, and its cover registered for artwork. */
  toTrack(song: OnlineSong): Track
  /** The upstream id inside one of this platform's track ids, or null. */
  songIdOf(track: Track): number | null

  /**
   * Some platforms answer a useful shelf list before anyone signs in (Kugou
   * serves its public charts that way). Declaring it tells `init` to load the
   * shelf on a signed-out start instead of waiting for a login that may never
   * come; platforms that need an account simply keep it unset.
   */
  anonymousPlaylists?: boolean

  myPlaylists?(): Promise<OnlinePlaylistSummary[]>
  playlistTracks?(id: number): Promise<OnlineSong[]>
  /**
   * 一张歌单是谁建的。
   *
   * 推荐位上的卡片来自平台的公开推荐接口，那一路不带创建者；详情页缺名字时用这个
   * 补问一次。不实现的平台就让它继续显示「—」，不要编。
   */
  playlistCreator?(id: number): Promise<string>
  albumSongs?(id: number): Promise<OnlineSong[]>
  artistTopSongs?(id: number, limit: number): Promise<OnlineSong[]>
  /** One generated collection (daily / likes / cloud), for a platform that has them. */
  collection?(kind: OnlineCollectionKind, limit: number): Promise<OnlineSong[]>

  loginStatus(): Promise<OnlineAccount | null>
  logout(): Promise<void>
  /**
   * Whether the platform's backend can reach its upstream right now.
   *
   * Distinct from "is anyone signed in": search and playback work signed out on
   * both platforms, so a signed-out but reachable backend is ready. Optional,
   * because a platform whose client exposes no health check is assumed reachable
   * when it answers `loginStatus` at all.
   */
  status?(): Promise<{ ready: boolean; detail?: string }>
  /**
   * 这一家现在能不能给出音频地址。
   *
   * 与 status 是两件事：status 说的是「后台活着」，这里说的是「点播放真能出声」。
   * 酷狗就是这样——榜单和漫游对游客照给，取流却一律回 login-required。缺这个方法
   * 就当作能播：只有明确知道自己「能浏览但放不了」的平台才需要声明。
   */
  canStream?(): Promise<boolean>
  /** Bind the main process to a profile before anything else is asked of it. */
  bindProfile?(profileId: string): Promise<void>
}

export interface OnlineStore {
  providerId: ProviderId

  ready: boolean
  backendBlocked: boolean
  statusDetail: string | null
  account: OnlineAccount | null

  quality: QualityTier
  /**
   * What the last successful stream actually delivered, in words.
   *
   * Reported because a request for a high tier can be answered with a lower one:
   * anonymous playback on any platform caps out well below the top tier, and
   * without this the user picks 无损, hears 128 kbps, and concludes the player is
   * broken. `deliveredFellBack` says whether that is what happened, so the note is
   * only shown when there is something to explain.
   */
  delivered: string | null
  deliveredFellBack: boolean
  /**
   * The tier upstream actually delivered, and for which song.
   *
   * Kept structured rather than only as prose because the quality menu needs to
   * act on it: a tier above what this song has been proven to serve is disabled
   * and labelled, so the user sees the ceiling where they choose the tier instead
   * of only in a note after playback starts. Learned by Mineradio doing exactly
   * this with a per-song "runtime cap".
   */
  deliveredLevel: QualityTier | 'hires' | null
  deliveredLevelSongId: number | null
  /** The song playback last moved to, for scoping the per-song quality ceiling. */
  currentSongId: number | null

  query: string
  searchKind: OnlineSearchKind
  searching: boolean
  searched: boolean
  songs: OnlineSong[]
  albums: OnlineAlbumRef[]
  artists: OnlineArtistRef[]

  /** Which collection is open, or null when the platform's front page is showing. */
  collectionKind: OnlineCollectionKind | null
  /** Playlist / album / artist id whose tracks are open. */
  openId: number | null
  openName: string | null
  openCover: string | null
  collection: OnlineSong[]

  playlists: OnlinePlaylistSummary[]
  playlistsLoading: boolean
  /**
   * 从卡片点进来的那一份「脸」：名字 / 封面 / 创建者。
   *
   * 详情页要拿这三样画头部，但推荐位上的单子不一定在「我的歌单」里，
   * `playlists` 因此查不到它。点卡片时顺手记下来，页面就不必为了一个标题再问一次上游。
   */
  knownPlaylists: Record<number, PlaylistFace>

  fail: PlatformFail | null
  loadingTracks: boolean

  init(): Promise<void>
  setQuality(quality: QualityTier): Promise<void>
  setQuery(query: string): void
  setSearchKind(kind: OnlineSearchKind): void
  submitSearch(): Promise<void>
  loadPlaylists(): Promise<void>
  openCollection(kind: OnlineCollectionKind): Promise<void>
  rememberPlaylist(face: PlaylistFace): void
  openPlaylist(id: number): Promise<void>
  openAlbum(id: number): Promise<void>
  openArtist(id: number): Promise<void>
  playAt(list: OnlineSong[], index: number): Promise<void>
  ensureStream(songId: number): Promise<void>
  prefetch(tracks: Track[]): void
  clearFail(): void
  refreshAccount(): Promise<void>
  logout(): Promise<void>
}

/**
 * 一张歌单的最小画像：详情页头部只需要这三样。
 *
 * 不复用 `OnlinePlaylistSummary`：那份形状带着归属、播放数、订阅标记，
 * 推荐位上的卡片本来就没有这些东西，硬填只会编出假数据。
 */
export interface PlaylistFace {
  id: number
  name: string
  coverUrl: string | null
  creator: string
  /**
   * 这张单子是谁的。推荐位上的卡片是 `'unknown'`——平台推给你的，不是你建的，
   * 详情页据此不摆改名 / 删除。列表接口自己给了归属的，也一并记下来。
   */
  ownership?: PlaylistOwnership
}

/** Fetched collections are cached: both upstreams rate-limit and change slowly. */
const CATALOG_TTL_MS = 10 * 60 * 1000

interface CatalogEntry {
  at: number
  songs: OnlineSong[]
}

type OnlineStoreApi = ReturnType<typeof createOnlineStore>

const stores = new Map<ProviderId, OnlineStoreApi>()
/** 每个平台正在跑的那一次 init，用来把并发调用收成一次。 */
const initInflight = new Map<ProviderId, Promise<void>>()
const catalogs = new Map<string, CatalogEntry>()

/** The store for a platform, created on first use. One per platform, never shared. */
export function useOnlineStore(providerId: ProviderId): OnlineStoreApi {
  const existing = stores.get(providerId)
  if (existing) return existing
  const created = createOnlineStore(providerId)
  stores.set(providerId, created)
  return created
}

/** The same store outside React, for the transport wiring and one-off reads. */
export function onlineStoreState(providerId: ProviderId): OnlineStore {
  return useOnlineStore(providerId).getState()
}

/**
 * The transport's resume callback, per platform.
 *
 * The store may not import the audio engine - the engine imports the library
 * source, which imports this layer - so the one module allowed to import both
 * sides hands the callback in here.
 */
const resumeHandlers = new Map<ProviderId, () => void>()

 function setResumeHandler(providerId: ProviderId, handler: () => void): void {
  resumeHandlers.set(providerId, handler)
}

function resumeHandlerFor(providerId: ProviderId): (() => void) | null {
  return resumeHandlers.get(providerId) ?? null
}

/**
 * The Netease store also needs this hook, because its playback wiring predates
 * this file. Registered under the same mechanism so both platforms recover the
 * same way.
 */
export function registerResumeHandler(providerId: ProviderId, handler: () => void): void {
  setResumeHandler(providerId, handler)
}

/** Whether a provider exists and declares a capability. */
export function providerHas(providerId: ProviderId, capability: 'search' | 'playback' | 'lyrics'): boolean {
  return providerSupports(getProvider(providerId), capability)
}

/** The sentence for a failure, naming the platform it came from. */
function failTextFor(providerId: ProviderId, reason: string): string {
  return failureText(reason as never, getProvider(providerId)?.displayName ?? '在线平台')
}

function createOnlineStore(providerId: ProviderId) {
  /** The profile this store's account belongs to; switching drops everything. */
  let boundProfile: string | null = null
  /** A load that found no cached URL, waiting on the fetch now running. */
  let pendingRecovery: { songId: number; at: number } | null = null

  const backend = (): PlatformBackend | null =>
    (getProvider(providerId)?.backend as PlatformBackend | undefined) ?? null

  /** Re-load the current track once its URL has arrived. */
  const recover = (songId: number): void => {
    if (!pendingRecovery || pendingRecovery.songId !== songId) return
    if (Date.now() - pendingRecovery.at > RECOVER_WINDOW_MS) {
      pendingRecovery = null
      return
    }
    pendingRecovery = null
    const resume = resumeHandlerFor(providerId)
    if (!cachedStream(providerId, songId) || !resume) return
    resume()
  }

  return create<OnlineStore>()((set, get) => {
    const fail = (reason: string, message: string, songId: number | null = null): void =>
      set({ fail: { reason, message, songId, at: Date.now() } })

    /*
     * 取不到播放地址时界面不会有任何别的变化：队列进了、行也高亮了，就是没有声音。
     * 沉默等于「点了没反应」，所以这条路径必须自己说一句话。页面加载失败不用喊，
     * 那些地方本来就有空态。
     */
    const announce = (reason: string): void => {
      showFlash(failTextFor(providerId, reason))
    }

    /** Drop everything that belonged to the previous account or profile. */
    const reset = (): void => {
      clearStreams(providerId)
      clearCatalogs(providerId)
      set({
        account: null,
        playlists: [],
        playlistsLoading: false,
        collectionKind: null,
        openId: null,
        openName: null,
        openCover: null,
        collection: [],
        songs: [],
        albums: [],
        artists: [],
        searched: false,
        fail: null,
        loadingTracks: false
      })
    }

    /**
     * Resolve one song's URL by id, at most once at a time, remembering a refusal briefly.
     *
     * Only the id is passed on purpose: each main-process client keeps its own song
     * index, and a queue built by roam (or restored from disk) carries ids without
     * ever having passed through this store's lists. This used to require the song
     * record, which made exactly those queues silent while the same song played
     * fine from a collection that happened to be open.
     *
     * The three outcomes stay distinct on purpose - a stream, a refusal and a miss.
     * Collapsing the last two is exactly how "you are not signed in" becomes
     * "this is gone".
     */
    const fetchStream = (songId: number): Promise<void> =>
      dedupe(providerId, songId, async () => {
        const platform = backend()
        if (!platform) {
          const message = '这个构建没有该平台的后端'
          rememberFailure(providerId, songId, 'service-unavailable', message)
          fail('service-unavailable', message, songId)
          announce('service-unavailable')
          return
        }

        const quality = get().quality
        const result = await platform.streamUrl(songId, quality)

        if (result.ok) {
          rememberStream(providerId, songId, result.stream)
          set({
            delivered: streamSummary(result.stream, quality),
            deliveredFellBack: isQualityFallback(result.stream.level, quality),
            deliveredLevel: result.stream.level,
            deliveredLevelSongId: songId,
            // A trial fragment is the account's ceiling, not a failure - worth
            // saying once, where what is playing is reported.
            fail: result.stream.trial
              ? { reason: 'trial-only', message: '只能试听片段', songId, at: Date.now() }
              : null
          })
          return
        }

        rememberFailure(providerId, songId, result.reason, result.message)
        fail(result.reason, result.message ?? '', songId)
        announce(result.reason)
      })

    /** Load a collection into the open slot, with one cache and one failure path. */
    const openInto = async (
      kind: OnlineCollectionKind,
      id: number,
      name: string | null,
      cover: string | null,
      load: () => Promise<OnlineSong[]>
    ): Promise<void> => {
      const cacheKey = `${providerId}:open:${id}`
      const cached = catalogs.get(cacheKey)
      if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
        set({ collectionKind: kind, openId: id, openName: name, openCover: cover, collection: cached.songs, fail: null })
        return
      }

      set({ collectionKind: kind, openId: id, openName: name, openCover: cover, loadingTracks: true, fail: null })
      try {
        const songs = await load()
        catalogs.set(cacheKey, { at: Date.now(), songs })
        set({ collection: songs })
      } catch (problem) {
        set({ collection: [] })
        fail('network', describe(problem))
      } finally {
        set({ loadingTracks: false })
      }
    }

    return {
      providerId,

      ready: false,
      backendBlocked: false,
      statusDetail: null,
      account: null,

      quality: DEFAULT_QUALITY,
      delivered: null,
      deliveredFellBack: false,
      deliveredLevel: null,
      deliveredLevelSongId: null,
      currentSongId: null,

      query: '',
      searchKind: 'song',
      searching: false,
      searched: false,
      songs: [],
      albums: [],
      artists: [],

      collectionKind: null,
      openId: null,
      openName: null,
      openCover: null,
      collection: [],

      playlists: [],
      playlistsLoading: false,
      knownPlaylists: {},

      fail: null,
      loadingTracks: false,

      /**
       * Ask the main process where this platform stands, and re-bind the profile.
       *
       * Safe to call repeatedly: a platform's first health check can fail on a cold
       * start and succeed a minute later, and the main process caches only a
       * successful bootstrap. Calling it when the screen opens, and offering a
       * retry, is what keeps a temporary fault from looking permanent.
       */
      async init() {
        /*
         * 单飞。
         *
         * 启动阶段有五六处都会 init：每个取数钩子各一次、首页一次、播放器接线
         * 一次。它们互相不知道对方，于是一次冷启动能把 loginStatus + bindProfile
         * 打到十几次，日志里就是 albumSublist 十余次、setProfile 四次那种场面。
         * 进来时若已经有一次在跑，就复用它；跑完才放行下一次（重试仍然有效）。
         */
        const running = initInflight.get(providerId)
        if (running) return running
        const task = (async () => {
          const platform = backend()
          if (!platform) {
            set({ ready: false, backendBlocked: true, statusDetail: '这个构建没有该平台的后端' })
            return
          }

          const profileId = useAccounts.getState().activeId
          if (profileId && profileId !== boundProfile) {
            boundProfile = profileId
            reset()
          }
          await platform.bindProfile?.(profileId ?? '')

          const status = await platform.loginStatus().then(
            (account) => ({ ok: true as const, account }),
            (problem: unknown) => ({ ok: false as const, problem })
          )

          if (!status.ok) {
            set({ ready: false, backendBlocked: true, statusDetail: describe(status.problem) })
            return
          }

          /*
           * Reachability and identity are separate questions. A signed-out but
           * healthy backend is ready - search and playback need no account - while a
           * backend that cannot reach its upstream is blocked even though it answered.
           * Collapsing the two would either hide search behind a login or report a
           * network fault as "not signed in".
           */
          const health = await platform.status?.().catch(() => undefined)

          set({
            ready: health?.ready ?? true,
            backendBlocked: health ? !health.ready : false,
            statusDetail: health?.detail ?? null,
            account: status.account,
            quality: await platform.getQuality().catch(() => get().quality)
          })
          if (status.account || platform.anonymousPlaylists) void get().loadPlaylists()
        })()
        initInflight.set(providerId, task)
        try {
          await task
        } finally {
          initInflight.delete(providerId)
        }
      },

      async setQuality(quality) {
        // Every cached link was signed for the previous tier, so none survive.
        clearStreams(providerId)
        /*
         * `deliveredLevel` deliberately survives: it records what the song was
         * proven to serve, which does not change because the user asked for
         * something else. Clearing it would drop the ceiling from the menu right
         * after the user picked a tier above it - exactly when it is most useful.
         */
        set({ quality, delivered: null, deliveredFellBack: false, fail: null })
        const platform = backend()
        if (!platform) return
        set({ quality: await platform.setQuality(quality).catch(() => quality) })
      },

      setQuery: (query) => set({ query }),
      setSearchKind: (searchKind) => set({ searchKind }),

      async submitSearch() {
        const keywords = get().query.trim()
        if (!keywords) {
          set({ songs: [], albums: [], artists: [], searched: false })
          return
        }

        const platform = backend()
        if (!platform) {
          set({ searching: false, searched: true })
          fail('service-unavailable', '这个构建没有该平台的后端')
          return
        }

        set({ searching: true })
        try {
          const result = await platform.search(keywords, 'song', 50)
          // A slower earlier search must not overwrite a newer one's results.
          if (get().query.trim() !== keywords) return
          set({
            songs: result.songs,
            albums: result.albums,
            artists: result.artists,
            searched: true,
            searching: false,
            fail: null
          })
        } catch (problem) {
          set({ searching: false, searched: true })
          fail('network', describe(problem))
        }
      },

      async loadPlaylists() {
        const platform = backend()
        if (!platform?.myPlaylists) return
        set({ playlistsLoading: true })
        try {
          set({ playlists: await platform.myPlaylists() })
        } catch (problem) {
          /*
           * A signed-out shelf is a convenience, not a promise: the platform may
           * decide to answer nobody. Reporting that as the page's error would put
           * a network failure in front of a user who never asked for anything.
           */
          if (get().account) fail('network', describe(problem))
        } finally {
          set({ playlistsLoading: false })
        }
      },

      async openCollection(kind) {
        const platform = backend()
        if (!platform?.collection) return

        const cacheKey = `${providerId}:${kind}`
        const label = getProvider(providerId)?.collections?.find((item) => item.kind === kind)?.label ?? ''
        const cached = catalogs.get(cacheKey)
        if (cached && Date.now() - cached.at < CATALOG_TTL_MS) {
          set({
            collectionKind: kind,
            openId: null,
            openName: label,
            openCover: null,
            collection: cached.songs,
            fail: null
          })
          return
        }

        set({ collectionKind: kind, openId: null, openName: label, openCover: null, loadingTracks: true, fail: null })
        try {
          const songs = await platform.collection(kind, 100)
          catalogs.set(cacheKey, { at: Date.now(), songs })
          set({ collection: songs })
        } catch (problem) {
          set({ collection: [] })
          fail('network', describe(problem))
        } finally {
          set({ loadingTracks: false })
        }
      },

      rememberPlaylist(face) {
        set({ knownPlaylists: { ...get().knownPlaylists, [face.id]: face } })
      },

      async openPlaylist(id) {
        const platform = backend()
        if (!platform?.playlistTracks) return
        const face = get().knownPlaylists[id]
        const summary = get().playlists.find((item) => item.id === id)
        const name = face?.name ?? summary?.name ?? null
        const cover = face?.coverUrl ?? summary?.coverUrl ?? null
        /*
         * 推荐位上的卡片不带创建者，详情页那一行就只能显示「—」。缺的时候补问一次
         * 歌单详情，把名字记回这张脸；已经有名字的不再问。
         */
        if (platform.playlistCreator && !(face?.creator || summary?.creator)) {
          void platform
            .playlistCreator(id)
            .then((creator) => {
              if (!creator) return
              const current = get().knownPlaylists[id]
              if (current?.creator) return
              get().rememberPlaylist({
                id,
                name: current?.name ?? name ?? '',
                coverUrl: current?.coverUrl ?? cover,
                creator,
                ownership: current?.ownership
              })
            })
            .catch(() => {})
        }
        await openInto('playlists', id, name, cover, () => platform.playlistTracks!(id))
      },

      async openAlbum(id) {
        const platform = backend()
        if (!platform?.albumSongs) return
        await openInto('playlists', id, null, null, () => platform.albumSongs!(id))
      },

      async openArtist(id) {
        const platform = backend()
        if (!platform?.artistTopSongs) return
        await openInto('playlists', id, null, null, () => platform.artistTopSongs!(id, 50))
      },

      /**
       * Start a queue at the clicked row.
       *
       * The first track's URL is resolved before the engine is handed the queue,
       * which keeps the common path free of the load-then-recover dance: with the
       * URL cached, `engine.load` finds a source on its first attempt.
       */
      async playAt(list, index) {
        const platform = backend()
        const song = list[index]
        if (!platform || !song) return
        /*
         * Recorded here rather than in `ensureStream`, which the retry button also
         * calls: this is the point where the song is actually going to play, and
         * the quality menu scopes its per-song ceiling to exactly this id.
         */
        set({ currentSongId: song.id })
        await get().ensureStream(song.id)
        /*
         * 明确取不到地址（记住的那条拒绝）就别把队列塞给播放器：否则播放条会亮起
         * 一首歌、进度停在 0:00、没有声音——看起来像卡住，而不是被拒绝。
         * 「还在路上」的那种要照装，`recover` 靠引擎已经加载了这首歌才找得回来。
         */
        if (!cachedStream(providerId, song.id) && cachedFailure(providerId, song.id)) return
        player.playQueue(list.map((item) => platform.toTrack(item)), index)
      },

      async ensureStream(songId) {
        if (cachedStream(providerId, songId)) return

        // A remembered refusal is reported rather than re-asked: remembering it is
        // the entire point of remembering it.
        const remembered = cachedFailure(providerId, songId)
        if (remembered) {
          fail(remembered.reason, remembered.message ?? '', songId)
          announce(remembered.reason)
          return
        }

        const platform = backend()
        if (!platform) return

        /*
         * Recording the attempt is what arms `recover`: when the fetch below
         * lands, the engine's load is re-run for the track that is already
         * playing. Without it a queue restored from disk, or advanced into past
         * the screen the user is looking at, would be silent with no explanation.
         */
        pendingRecovery = { songId, at: Date.now() }

        await fetchStream(songId)
        if (cachedStream(providerId, songId)) recover(songId)
      },

      prefetch(tracks) {
        const platform = backend()
        if (!platform) return
        // The next few tracks are resolved while the current one plays, so an
        // advance does not have to wait on the network. Metadata requests only:
        // buffering stays the audio element's business.
        for (const track of tracks.slice(0, 3)) {
          const songId = platform.songIdOf(track)
          if (songId === null) continue
          if (cachedStream(providerId, songId) || cachedFailure(providerId, songId)) continue
          void get().ensureStream(songId)
        }
      },

      clearFail: () => set({ fail: null }),

      async refreshAccount() {
        const platform = backend()
        if (!platform) return
        set({ account: await platform.loginStatus().catch(() => null) })
      },

      async logout() {
        const platform = backend()
        if (!platform) return
        await platform.logout().catch(() => undefined)
        // Personal lists belong to the account that just left.
        clearCatalogs(providerId)
        set({ account: null, playlists: [], collection: [], collectionKind: null, openId: null, openName: null })
      }
    }
  })
}

function clearCatalogs(providerId: ProviderId): void {
  for (const key of [...catalogs.keys()]) {
    if (key.startsWith(`${providerId}:`)) catalogs.delete(key)
  }
}

function describe(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem)
}
