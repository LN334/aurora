import type {
  CommentPage,
  NeteaseAccount,
  NeteaseApi,
  NeteaseQuality,
  NeteaseSong
} from '../../env'
import type { Track } from '../../types'
import { netease, hasNeteaseBackend } from './api'
import type { LyricBundle } from '../lyrics/align'
import { neteaseSongId, toTrack as toNeteaseTrack } from './track'
import { rememberNeteaseCover } from '../library/source'
import { registerProvider } from '../online/registry'
import { previewBackendsForced } from '../online/preview-harness'
import { registerResumeHandler } from '../online/store'
import { providerAccountFor, providerLoginStatus, providerLogout } from '../online/account-channel.ts'
import {
  providerMyPlaylists,
  providerPlaylistCreator,
  providerPlaylistTracks
} from '../online/playlist-channel.ts'
import { providerLike, providerLiked } from '../online/likes-channel.ts'
import {
  providerCommentLike,
  providerCommentSend,
  providerComments
} from '../online/comment-channel.ts'
import {
  providerAlbum,
  providerArtist,
  providerArtistAlbums,
  providerArtistSongs,
  providerArtistTopSongs
} from '../online/catalog-channel.ts'
import {
  providerCloudSongs,
  providerDailySongs,
  providerPersonalFm
} from '../online/recommend-channel.ts'
import type { PlatformBackend } from '../online/store'
import {
  playable,
  unknownAvailability,
  type OnlineCollection,
  type OnlineMusicProvider,
  type OnlinePlaylistSummary,
  type OnlineSong,
  type ProviderCapabilities,
  type QualityTier
} from '../online/types'

/**
 * Netease Cloud Music as a provider.
 *
 * Everything this platform *is* - its id, its capabilities, which collections it
 * offers, how a song becomes a `Track` - is declared here. The shared state
 * machine in `features/online/store.ts` drives it, and no view names Netease.
 *
 * The client access, the song mapping and the lyric merging stay in this module
 * because they are this platform's own code and are covered by tests. A rewrite
 * would buy nothing but risk.
 */

/**
 * The bridge calls whose signatures this adapter needs and the shared contract
 * does not describe.
 *
 * Typed through one narrow view rather than restating them, so what the bridge
 * promises stays `src/env.d.ts`'s business. The optional members are optional
 * there because a browser build has no session to bind and no account to look up.
 */
type NeteaseExtras = {
  setProfile?(profileId: string): Promise<boolean>
  songDetail(ids: number[]): Promise<NeteaseSong[]>
  accountFor?(profileId: string): Promise<import('../../env').NeteaseAccount | null>
}

const extras = netease as unknown as NeteaseExtras

/*
 * 通道把答复放宽成 unknown，形状仍只有一处定义：从桥自己的签名反推。
 * 不另抄一份接口——抄了就会在上游加字段时悄悄过期。
 */
type NeteaseAlbumRow = NonNullable<Awaited<ReturnType<NeteaseApi['album']>>>
type NeteaseArtistRow = NonNullable<Awaited<ReturnType<NeteaseApi['artistDetail']>>>
type NeteaseAlbumCardRow = Awaited<ReturnType<NeteaseApi['artistAlbums']>>[number]

/**
 * Netease's tiers, worst to best, exactly as the main process accepts them.
 *
 * 后四档在无损之上：Hi-Res、高清环绕声、沉浸环绕声、超清母带。列出来不等于一定
 * 拿得到——账号没有那份权益或曲目没有那份母带时，上游会把 level 打回低档，界面
 * 显示的是回包里真实的 level，不是这里选的那一档。
 */
const TIERS: QualityTier[] = [
  'standard',
  'higher',
  'exhigh',
  'lossless',
  'hires',
  'jyeffect',
  'sky',
  'jymaster'
]

/**
 * Which generated collections this platform has.
 *
 * Declared rather than inferred by a view from the platform's name. A platform
 * without daily recommendations simply does not list it, and the rail and the
 * screen follow without knowing which platform they are showing.
 */
const COLLECTIONS: OnlineCollection[] = [
  { kind: 'daily', label: '每日推荐', requiresAccount: true },
  { kind: 'likes', label: '我喜欢的音乐', requiresAccount: true },
  { kind: 'cloud', label: '我的音乐云盘', requiresAccount: true },
  { kind: 'playlists', label: '我的歌单', requiresAccount: true }
]

const CAPABILITIES: ProviderCapabilities = {
  search: true,
  playback: true,
  lyrics: true,
  auth: true,
  playlists: true,
  albums: true,
  artists: true,
  recommendations: true,
  userCloud: true,
  likes: true,
  comments: true,
  commentSend: true,
  commentLike: true
}

const neteaseBackend: PlatformBackend = {
  id: 'netease',
  displayName: '网易云音乐',

  getQuality: () => netease.getQuality() as Promise<QualityTier>,
  setQuality: (quality) => netease.setQuality(quality as NeteaseQuality) as Promise<QualityTier>,

  async search(keywords, _kind, limit) {
    /*
     * One request answers all three kinds: the upstream search returns songs,
     * albums and artists together. `kind` is the caller's choice of what to read,
     * not a parameter of the query - issuing three requests to fill one screen
     * would triple the load for the same bytes.
     */
    const result = await netease.search(keywords, 'song', limit)
    return { songs: result.songs, albums: result.albums, artists: result.artists }
  },

  async streamUrl(songId, quality) {
    const result = await netease.streamUrl(songId, quality as NeteaseQuality)
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message }
    return { ok: true, stream: result.stream }
  },

  async songById(songId) {
    // A restored queue can name a track no list on screen holds; this is how its
    // record is recovered so its URL can be resolved at all.
    const songs = await extras.songDetail([songId]).catch(() => [] as NeteaseSong[])
    return songs[0] ?? null
  },

  toTrack(song) {
    const track = toNeteaseTrack(song)
    // The artwork layer resolves a cover from the track alone, and `Track` has
    // nowhere to carry the upstream URL, so it is registered where the row is built.
    rememberNeteaseCover(track.id, song.album.picUrl)
    return track
  },

  songIdOf: (track: Track) => neteaseSongId(track),

  myPlaylists: () => providerMyPlaylists<OnlinePlaylistSummary>('netease'),
  playlistTracks: (id) => providerPlaylistTracks<OnlineSong>('netease', id),
  playlistCreator: (id) => providerPlaylistCreator('netease', id),
  artistTopSongs: (id, limit) => providerArtistTopSongs<NeteaseSong>('netease', id, limit),

  async albumSongs(id) {
    const album = await providerAlbum<NeteaseAlbumRow>('netease', id)
    return album?.songs ?? []
  },

  async collection(kind) {
    if (kind === 'daily') return providerDailySongs<OnlineSong>('netease')
    if (kind === 'likes') return providerLiked<OnlineSong>('netease')
    if (kind === 'cloud') return providerCloudSongs<OnlineSong>('netease')
    // 'playlists' is not a song list: the playlists themselves come from
    // `myPlaylists`, and opening one goes through `playlistTracks`.
    return []
  },

  async loginStatus() {
    const account = await providerLoginStatus<NeteaseAccount>('netease')
    return account
      ? {
          id: account.userId,
          nickname: account.nickname,
          avatarUrl: account.avatarUrl,
          vip: account.vip,
          level: account.level
        }
      : null
  },

  async logout() {
    await providerLogout('netease')
  },

  async bindProfile(profileId) {
    // Nothing to bind in a build whose bridge has no profile-aware session.
    if (!profileId) return
    await extras.setProfile?.(profileId)
  }
}

 const neteaseProvider: OnlineMusicProvider = {
  id: 'netease',
  displayName: '网易云音乐',
  shortName: '网易云',
  summary: '搜索、歌单、每日推荐、红心与云盘，全部走第三方逆向接口',
  disclosure:
    '通过第三方逆向接口（NeteaseCloudMusicApiEnhanced）接入，仅供个人学习自用，不是官方客户端，也不提供绕过付费或会员的能力。',
  // Verified by measurement, not assumed: signed out, free tracks play in full and
  // paid ones arrive as trial fragments. No sign-in is required to search or play.
  anonymousNote: '搜索和播放不需要登录：免费歌曲可以完整播放，需要会员的歌给试听片段。',
  // True only when the main process actually exposes this client. A browser
  // preview and a build without the Electron half both answer false, and the rail
  // then shows no entry rather than an entry that cannot work. The harness override
  // exists so the layout *with* platforms stays checkable in a preview.
  available: () => previewBackendsForced() || hasNeteaseBackend,
  capabilities: CAPABILITIES,
  collections: COLLECTIONS,
  // 这两条是账号里的关系，不是「这一家支持不支持」的布尔项：有方法就有通道。
  collectedAlbums: () => netease.albumSublist(),
  followedArtists: () => netease.artistSublist(),
  qualityTiers: TIERS,
  /** 这几档要会员；账号明确是非会员时界面把它们藏起来。 */
  qualityNeedsVip: ['lossless', 'hires', 'jyeffect', 'sky', 'jymaster'],
  getQuality: neteaseBackend.getQuality,
  setQuality: neteaseBackend.setQuality,
  backend: neteaseBackend,

  search: {
    search: (keywords, kind, limit) => neteaseBackend.search(keywords, kind, limit ?? 50),
    songDetail: (ids) => extras.songDetail(ids)
  },

  playback: {
    streamUrl: (songId, quality) => neteaseBackend.streamUrl(songId, quality ?? 'exhigh'),

    /*
     * A preliminary hint only, never a verdict.
     *
     * The upstream's `fee` says what the *catalogue* requires, not what this
     * account can get: a signed-out listener may still receive a playable stream,
     * and a member may still be refused on region grounds. So a paid song is
     * `unknown` + `restricted` - "this may need a membership, the real request will
     * decide" - and only a free song is called playable.
     *
     * The verdict is never written back here. It arrives from the actual
     * `streamUrl` call and is displayed from there, which is why a wrong guess
     * costs a hint rather than a dead row.
     */
    getAvailability: (song) =>
      song.fee === 0 ? playable() : unknownAvailability('可能需要会员或购买')
  },

  lyrics: {
    async lyrics(songId): Promise<LyricBundle | null> {
      const raw = await netease.lyrics(songId)
      const body = raw?.lrc?.trim() ?? ''
      const sub = raw?.translation?.trim() ?? ''
      if (!body && !sub) return null
      return { lrc: body, translation: sub || null }
    }
  },

  auth: {
    loginStatus: () => neteaseBackend.loginStatus(),
    logout: () => neteaseBackend.logout(),
    // Profiles carry an online account, so the profiles screen asks per profile.
    // The main process answers that question, and its shape is converted here so
    // the shared layer never sees a Netease-specific field name.
    accountFor: async (profileId) => {
      const account = await providerAccountFor<NeteaseAccount>('netease', profileId)
      return account
        ? {
            id: account.userId,
            nickname: account.nickname,
            avatarUrl: account.avatarUrl,
            vip: account.vip,
            level: account.level
          }
        : null
    }
  },

  catalog: {
    album: async (id) => {
      const album = await providerAlbum<NeteaseAlbumRow>('netease', id)
      if (!album) return null
      return {
        id: album.id,
        name: album.name,
        coverUrl: album.coverUrl,
        songs: album.songs,
        year: album.year,
        description: album.description,
        artistName: album.artist
      }
    },
    artist: async (id) => {
      const detail = await providerArtist<NeteaseArtistRow>('netease', id)
      if (!detail) return null
      return {
        id,
        name: detail.name,
        brief: detail.briefDesc,
        coverUrl: detail.coverUrl,
        albumCount: detail.albumCount,
        songCount: detail.songCount
      }
    },
    artistTopSongs: (id, limit) => providerArtistTopSongs<NeteaseSong>('netease', id, limit),
    /*
     * 艺人页那两个标签页从前由页面直接调 `bridge.netease`，别的平台就没有。
     * 搬进 catalog 之后四家走同一条路，页面按「有没有这个方法」决定给不给入口。
     */
    artistSongs: (id, limit, offset) => providerArtistSongs<NeteaseSong>('netease', id, limit, offset),
    async artistAlbums(id, limit, offset) {
      const rows = await providerArtistAlbums<NeteaseAlbumCardRow>('netease', id, limit, offset)
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        // 上游的专辑卡片不带艺人名，页面用页头那一个；留空比编一个准。
        artist: '',
        picUrl: row.coverUrl,
        year: row.year,
        songCount: row.songCount
      }))
    },
    playlistTracks: (id) => providerPlaylistTracks<OnlineSong>('netease', id),
    myPlaylists: () => providerMyPlaylists<OnlinePlaylistSummary>('netease')
  },

  recommendations: {
    dailySongs: () => providerDailySongs<OnlineSong>('netease'),
    // 上游这个接口不给游客，未登录时问了也是空。
    dailyNeedsAccount: true,
    personalFm: (limit) => providerPersonalFm<OnlineSong>('netease', limit),
    likeList: () => providerLiked<OnlineSong>('netease'),
    cloudSongs: () => providerCloudSongs<OnlineSong>('netease')
  },

  /*
   * 喜欢的读写。写操作走主进程的 netease:like，它先确认登录再发请求——未登录
   * 的写会被上游拒绝，提前拦下来可以给界面一句「先登录」。
   */
  likes: {
    list: () => providerLiked<OnlineSong>('netease'),
    set: (songId, liked) => providerLike('netease', songId, liked)
  },

  /*
   * 评论三件事。四家里只有网易云三件齐全（QQ/酷狗能发不能赞，汽水只能读），
   * 差的那几件不是在界面里藏按钮，而是这里不写方法——能力表由方法反推。
   */
  comments: {
    list: (songId, cursor, limit) => providerComments<CommentPage>('netease', songId, cursor, limit),
    send: (songId, content) => providerCommentSend('netease', songId, content),
    like: (songId, commentId, liked) =>
      providerCommentLike('netease', songId, commentId, liked)
  },

  /*
   * 自己建的歌单：建、加减歌、改名、删单。
   *
   * 四家里目前只有网易云在接口上能写（QQ/酷狗/汽水那三家上游只给了读，或者
   * 只给了加歌删歌没给建单）。所以这一支只挂在网易云上，别的平台没有它就等于
   * 页面不给编辑入口——而不是给一个点了没反应的按钮。
   */
  playlists: {
    create: (name) => netease.playlistCreate(name),
    addTracks: (id, songIds) => netease.playlistAddTracks(id, songIds),
    removeTracks: (id, songIds) => netease.playlistRemoveTracks(id, songIds),
    rename: (id, name) => netease.playlistRename(id, name),
    remove: (id) => netease.playlistDelete(id)
  }
}

/**
 * Let a late-arriving URL re-load the track that is already playing.
 *
 * `features/player/netease.ts` owns the actual re-load - it is the one module
 * allowed to import both the transport and the store - and registers it here at
 * startup. The shared store calls back when a stream it was waiting for lands,
 * which is what makes an expired link recover instead of going silent.
 */
let neteaseResume: (() => void) | null = null

export function setNeteaseResumeHandler(handler: (() => void) | null): void {
  neteaseResume = handler
  registerResumeHandler('netease', () => neteaseResume?.())
}



export function registerNeteaseProvider(): void {
  registerProvider(neteaseProvider)
}
