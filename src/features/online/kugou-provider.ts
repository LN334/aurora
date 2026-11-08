import type { KugouApi } from '../../env'
import type { QualityTier } from './types'
import { previewBackendsForced } from './preview-harness'
import { normalizeSearchResult, normalizeSong } from './normalize'
import { registerProvider } from './registry'
import type { PlatformBackend } from './store'
import {
  playable,
  unknownAvailability,
  type OnlineCollection,
  type OnlineMusicProvider,
  type OnlineSong,
  type ProviderCapabilities
} from './types'
import type { Track } from '../../types'

/**
 * 酷狗作为第三个平台。
 *
 * 结构照 `qq-provider.ts`：能力声明、id 约定、几处桥调用，别的都在共享状态机里。
 * 两处不同值得写下来：
 *
 * 1. **后端是一个本地服务，不是一个 SDK**。主进程负责把它拉起来，这里只问
 *    「有没有」——和 QQ 一样读 `window.aurora.kugou`，浏览器里是 null。
 * 2. **歌单 id 是主进程发的数字别名**。共享界面按正整数取歌单，而上游的身份是
 *    `global_collection_id` 字符串；别名由主进程在本次会话里维护，这里只负责
 *    原样传下去，不去猜上游 id 的形状。
 */

/**
 * 每次调用时读，不在模块加载时抓。
 *
 * preload 与主进程独立接线，抓一个 `undefined` 会让一个能用的后端在整个窗口
 * 生命周期里看起来不存在。
 */
function client(): KugouApi | null {
  if (typeof window === 'undefined') return null
  return window.aurora?.kugou ?? null
}

/** 与另外两个平台同一套四档；具体能拿到哪一档由客户端逐档下降决定。 */
const TIERS: QualityTier[] = ['standard', 'higher', 'exhigh', 'lossless']

/**
 * 酷狗没有「每日推荐 / 我喜欢的音乐」这类账号集合可读，所以这里空着。
 *
 * 歌单不走 `collections`：`myPlaylists` 是平台无关的入口，登录后读账号自己的
 * 歌单，未登录读公开榜单——那是「能浏览」而不是「属于我」，所以不声明成集合。
 */
const COLLECTIONS: OnlineCollection[] = []

const CAPABILITIES: ProviderCapabilities = {
  search: true,
  playback: true,
  // 歌词接口要 accesskey（实测匿名拿不到），所以不声明，界面也就不会给入口。
  lyrics: false,
  auth: true,
  playlists: true,
  albums: false,
  artists: false,
  recommendations: false,
  userCloud: false,
  likes: false
}

const kugouBackend: PlatformBackend = {
  id: 'kugou',
  displayName: '酷狗音乐',

  async getQuality() {
    return (await client()?.getQuality()) ?? 'exhigh'
  },

  async setQuality(quality) {
    return (await client()?.setQuality(quality)) ?? quality
  },

  async search(keywords, kind, limit) {
    const result = await client()?.search(keywords, kind, limit)
    // 客户端已经整理成共享形状；这里过一遍容错读取器，接住它以后可能加的字段。
    return normalizeSearchResult(result)
  },

  async streamUrl(songId, quality) {
    const result = await client()?.streamUrl(songId, quality)
    if (!result) return { ok: false, reason: 'service-unavailable' }
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message }

    return {
      ok: true,
      stream: {
        url: result.url,
        br: result.br,
        level: result.level,
        // 酷狗不给试听片段的长度信息：拿到了就是整首，拿不到就返回原因。
        duration: 0,
        trial: result.trial
      }
    }
  },

  async songById() {
    /*
     * 上游没有「按 id 取一首」的接口，搜索与歌单是仅有的两个来源。如实答 null：
     * 共享状态机随后会说「这首歌查不到」，而不是凭 id 编一个标题出来。
     */
    return null
  },

  toTrack(song) {
    const id = trackIdFor(song)
    return {
      id,
      path: id,
      source: 'kugou',
      title: song.name,
      artist: song.artists.map((artist) => artist.name).join(' / '),
      albumArtist: song.artists[0]?.name ?? '',
      album: song.album.name,
      genre: '',
      year: null,
      trackNo: null,
      discNo: null,
      duration: song.duration,
      bitrate: null,
      sampleRate: null,
      channels: 2,
      codec: 'mp3',
      // 上游不说实际回来的是什么编码，所以不因为请求了无损就贴 FLAC 标签。
      lossless: false,
      size: 0,
      mtimeMs: 0,
      addedAt: Date.now(),
      hasArt: Boolean(song.album.picUrl),
      coverUrl: song.album.picUrl ?? undefined,
      /*
       * 播放器按数字 id 取流，酷狗的取流身份是 hash 三件套。数字 id 和上游的
       * 字符串身份都带在行上：前者给播放器，后者万一以后要按上游身份去重。
       */
      onlineId: song.id,
      gainDb: null,
      peak: null
    }
  },

  songIdOf(track: Track) {
    if (track.source !== 'kugou') return null
    const id = Number(track.id.slice('kugou:'.length))
    return Number.isFinite(id) ? id : null
  },

  async loginStatus() {
    const account = await client()?.loginStatus()
    if (!account) return null
    return {
      id: account.id,
      nickname: account.nickname,
      avatarUrl: account.avatarUrl,
      // 酷狗不报会员状态：false 在这里表示「没有检测到」，不是「不是会员」。
      vip: false,
      level: 0
    }
  },

  async logout() {
    await client()?.logout()
  },

  async status() {
    const status = await client()?.status()
    return status ? { ready: status.ready, detail: status.detail } : { ready: false }
  },

  async bindProfile(profileId) {
    if (!profileId) return
    await client()?.setProfile(profileId)
  },

  /*
   * 歌单。
   *
   * 未登录时上游给的是公开榜单：能浏览、能点开，点播放会得到「需要登录」。
   * 读不到就答空数组——空货架是诚实的画面，界面已经在未登录时说明了登录能
   * 多出什么。
   */
  // 未登录时 /top/playlist 也给公开榜单，所以货架不等登录。
  anonymousPlaylists: true,

  async myPlaylists() {
    const rows = (await client()?.myPlaylists()) ?? []
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      coverUrl: row.coverUrl,
      trackCount: row.trackCount,
      // 上游不在这个接口里报播放量，所以留 0，不拿另一个接口的数字充数。
      playCount: 0,
      creator: row.creator,
      /*
       * `/user/playlist` 只给一张表，自建与收藏不分开；未登录时给的还是公开榜单。
       * 三种情况都没法判定归属，就答「分不出来」，别把公开榜单说成「我收藏的」。
       */
      subscribed: false,
      ownership: 'unknown' as const
    }))
  },

  async playlistTracks(id) {
    const rows = (await client()?.playlistTracks(id)) ?? []
    return rows.map((song) => normalizeSong(song))
  }
}

const kugouProvider: OnlineMusicProvider = {
  id: 'kugou',
  displayName: '酷狗音乐',
  shortName: '酷狗',
  summary: '搜索酷狗音乐、打开歌单；取播放地址需要登录账号',
  disclosure:
    '通过第三方逆向接口（KuGouMusicApi 本地服务）接入，仅供个人学习自用，不是官方客户端，也不提供绕过付费或会员的能力。',
  anonymousNote: '未登录也能搜索、浏览公开榜单；取播放地址需要登录酷狗账号。',
  // 只有真正带主进程客户端的构建才为 true；浏览器预览与旧构建都是 false，
  // 侧栏因此不会出现一个点不开的入口。
  available: () => previewBackendsForced() || client() !== null,
  capabilities: CAPABILITIES,
  collections: COLLECTIONS,
  qualityTiers: TIERS,
  getQuality: kugouBackend.getQuality,
  setQuality: kugouBackend.setQuality,
  backend: kugouBackend,

  search: {
    search: (keywords, kind, limit) => kugouBackend.search(keywords, kind, limit ?? 50)
  },

  playback: {
    streamUrl: (songId, quality) => kugouBackend.streamUrl(songId, quality ?? 'exhigh'),

    /*
     * 目录提示，不是判决。
     *
     * 酷狗对未登录请求一律答 20028（实测四种入参组合），拒绝本身由客户端分类；
     * 这里只按 `fee` 说「可能需要会员」，绝不写成 unavailable——那等于宣称这首歌
     * 下架了。
     */
    getAvailability: (song) => (song.fee === 0 ? playable() : unknownAvailability('可能需要会员'))
  },

  catalog: {
    // 上游没有专辑页与艺人页：答「没有」就是全部答案，capabilities 已挡住入口。
    album: async () => null,
    artistTopSongs: async () => [],
    playlistTracks: (id) => kugouBackend.playlistTracks!(id),
    myPlaylists: () => kugouBackend.myPlaylists!()
  },

  auth: {
    loginStatus: () => kugouBackend.loginStatus(),
    logout: () => kugouBackend.logout(),
    accountFor: async (profileId) => {
      const account = await client()?.accountFor(profileId)
      return account
        ? {
            id: account.id,
            nickname: account.nickname,
            avatarUrl: account.avatarUrl,
            vip: false,
            level: 0
          }
        : null
    }
  }
}

/**
 * 一首歌在本层的 id：`kugou:<数字 id>`。
 *
 * 数字 id 是主进程在搜索/歌单时发的那把钥匙，取流时再换回 hash 三件套。字符串
 * 前缀让同一份队列里三个平台的 id 不会互相冒充。
 */
function trackIdFor(song: OnlineSong): string {
  return `kugou:${song.id}`
}

export function registerKugouProvider(): void {
  registerProvider(kugouProvider)
}
