import type { QishuiApi, QishuiSong } from '../../env'
import type { QualityTier } from './types'
import { previewBackendsForced } from './preview-harness'
import { registerProvider } from './registry'
import type { PlatformBackend } from './store'
import {
  unknownAvailability,
  type OnlineCollection,
  type OnlineMusicProvider,
  type OnlineSong,
  type ProviderCapabilities
} from './types'
import type { Track } from '../../types'

/**
 * 汽水音乐作为第四个平台。
 *
 * 结构照 kugou-provider：能力声明、id 约定、几处桥调用，别的都在共享状态机里。
 * 三处不同值得写下来：
 *
 * 1. 后端是主进程里 require 的一个 npm SDK，没有本地服务、没有端口；
 *    这里同样只问「有没有」，浏览器里 window.aurora.qishui 是 null。
 * 2. 所有 id 都是主进程发的数字别名（上游是 19 位字符串），这里原样传，不猜形状。
 * 3. 上游只有歌曲搜索与艺人歌曲，没有专辑搜索、没有专辑页，所以 albums 声明为
 *    false，界面上也就不会给出一个点进去是空的入口。
 */

function client(): QishuiApi | null {
  if (typeof window === 'undefined') return null
  return window.aurora?.qishui ?? null
}

/**
 * 只声明标准档。
 *
 * 上游的 high / lossless / hires 要登录且带会员，实测未登录请求只有 standard
 * 返回的是没加密的地址。把四档都列出来会让音质设置里出现三个选了也没用的按钮，
 * 所以这里只列真能拿到的那一档；用户登录后由客户端按 vip-required 如实回答。
 */
const TIERS: QualityTier[] = ['standard']

/** 汽水没有每日推荐/我喜欢的集合接口（登录后才有），先不声明，界面就不给入口。 */
const COLLECTIONS: OnlineCollection[] = []

const CAPABILITIES: ProviderCapabilities = {
  search: true,
  playback: true,
  lyrics: false,
  auth: true,
  playlists: true,
  albums: false,
  artists: true,
  recommendations: false,
  userCloud: false,
  likes: false
}

/** 共享层的音质档位翻成汽水自己的四个名字。 */
function upstreamQuality(tier: QualityTier): 'standard' | 'high' | 'lossless' | 'hires' {
  if (tier === 'lossless') return 'lossless'
  if (tier === 'exhigh' || tier === 'higher') return 'high'
  return 'standard'
}

/** 汽水把 id 放在 19 位字符串里；账号只要一个数字，取末九位足够稳定。 */
function accountIdOf(id: string): number {
  const digits = id.replace(/\D/g, '')
  const tail = digits.slice(-9)
  const value = Number(tail)
  return Number.isFinite(value) ? value : 0
}

const qishuiBackend: PlatformBackend = {
  id: 'qishui',
  displayName: '汽水音乐',

  async getQuality() {
    return 'standard'
  },

  async setQuality(quality) {
    /*
     * 不落盘：汽水真正能给的只有标准档，记住一个「选了无损」的偏好只会让下次
     * 启动时设置页显示一个与取流结果不符的值。
     */
    return quality
  },

  async search(keywords, kind, limit) {
    if (kind !== 'song') return { songs: [], albums: [], artists: [] }
    const result = await client()?.search(keywords, limit)
    const songs = (result?.songs ?? []).map((song) => asOnlineSong(song))
    return { songs, albums: [], artists: [] }
  },

  async streamUrl(songId, quality) {
    const result = await client()?.streamUrl(songId, upstreamQuality(quality))
    if (!result) return { ok: false, reason: 'service-unavailable' }
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message }
    return {
      ok: true,
      stream: {
        url: result.url,
        br: result.br,
        level: result.level === 'standard' ? 'standard' : quality,
        // 汽水不报试听片段的长度：拿到的是整首，拿不到就返回原因。
        duration: 0,
        trial: result.trial
      }
    }
  },

  async songById(songId) {
    const song = await client()?.song(songId)
    return song ? asOnlineSong(song) : null
  },

  toTrack(song) {
    const id = trackIdFor(song)
    return {
      id,
      path: id,
      source: 'qishui',
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
      codec: 'm4a',
      lossless: false,
      size: 0,
      mtimeMs: 0,
      addedAt: Date.now(),
      hasArt: Boolean(song.album.picUrl),
      coverUrl: song.album.picUrl ?? undefined,
      onlineId: song.id,
      albumId: song.album.id,
      artistId: song.artists[0]?.id,
      gainDb: null,
      peak: null
    }
  },

  songIdOf(track: Track) {
    if (track.source !== 'qishui') return null
    const id = Number(track.id.slice('qishui:'.length))
    return Number.isFinite(id) ? id : null
  },

  async loginStatus() {
    const account = await client()?.loginStatus()
    if (!account) return null
    return {
      id: accountIdOf(account.id),
      nickname: account.nickname,
      avatarUrl: account.avatarUrl,
      // 汽水不报会员状态：false 是「没有检测到」，不是「不是会员」。
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
   * 歌单要登录才读得到（上游对未登录答 auth-required），所以不设 anonymous。
   * 读不到就答空数组——空货架是诚实的画面，账号页已经说明登录能多出什么。
   */
  async myPlaylists() {
    const rows = (await client()?.myPlaylists()) ?? []
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      coverUrl: row.coverUrl,
      trackCount: row.trackCount,
      // 上游不在这个接口报播放量，留 0，不拿别的接口数字充数。
      playCount: 0,
      creator: row.creator,
      subscribed: true
    }))
  },

  async playlistTracks(id) {
    const rows = (await client()?.playlistTracks(id)) ?? []
    return rows.map((song) => asOnlineSong(song))
  },

  async artistTopSongs(id, limit) {
    const rows = (await client()?.artistSongs(id, limit)) ?? []
    return rows.map((song) => asOnlineSong(song))
  }
}

const qishuiProvider: OnlineMusicProvider = {
  id: 'qishui',
  displayName: '汽水音乐',
  shortName: '汽水',
  summary: '搜索并播放汽水音乐上的歌曲；歌单与更高音质需要登录抖音账号',
  disclosure:
    '通过第三方逆向接口（qishui-music-api）接入，仅供个人学习自用，不是官方客户端，也不提供绕过付费或会员的能力。',
  anonymousNote: '未登录也能搜索并播放免费歌曲（标准音质）；歌单与高音质需要登录。',
  available: () => previewBackendsForced() || client() !== null,
  capabilities: CAPABILITIES,
  collections: COLLECTIONS,
  qualityTiers: TIERS,
  getQuality: qishuiBackend.getQuality,
  setQuality: qishuiBackend.setQuality,
  backend: qishuiBackend,

  search: {
    search: (keywords, kind, limit) => qishuiBackend.search(keywords, kind, limit ?? 50)
  },

  playback: {
    streamUrl: (songId, quality) => qishuiBackend.streamUrl(songId, quality ?? 'standard'),
    /*
     * 目录提示，不是判决。汽水没有 fee 字段，能搜到不代表能播（会员曲目要登录），
     * 所以一律答「未知 + 可能需要会员」，真正的结论由那次请求给出。
     */
    getAvailability: () => unknownAvailability('可能需要会员或登录')
  },

  catalog: {
    // 上游没有专辑页；answer null 就是全部答案，capabilities 已挡住入口。
    album: async () => null,
    /*
     * 艺人简介与头像是 artist_detail 给的；albumCount 恒 0（汽水没有「这位艺人的
     * 专辑列表」接口），页面会少显示这一段而不是编一个数字。
     */
    artist: async (id) => {
      const profile = await client()?.artistProfile(id)
      if (!profile) return null
      return {
        id,
        name: profile.name,
        brief: profile.description,
        coverUrl: profile.coverUrl,
        albumCount: 0,
        songCount: profile.trackCount
      }
    },
    artistTopSongs: (id, limit) => qishuiBackend.artistTopSongs!(id, limit ?? 50),
    playlistTracks: (id) => qishuiBackend.playlistTracks!(id),
    myPlaylists: () => qishuiBackend.myPlaylists!()
  },

  auth: {
    loginStatus: () => qishuiBackend.loginStatus(),
    logout: () => qishuiBackend.logout(),
    accountFor: async (profileId) => {
      /*
       * 汽水的会话绑定在设备 id 上，多档案其实就是多份 deviceId+session。
       * client 的 setProfile 已经切过了，这里读当前账号即可。
       */
      void profileId
      return qishuiBackend.loginStatus()
    }
  }
}

/** 汽水一首歌在共享层的形状。 */
function asOnlineSong(song: QishuiSong): OnlineSong {
  return {
    id: song.id,
    mid: song.mid,
    name: song.name,
    artists: song.artists.map((artist) => ({ id: artist.id, name: artist.name })),
    album: { id: song.album.id, name: song.album.name, picUrl: song.album.picUrl },
    duration: song.duration,
    /* 汽水不报 fee：0 表示「没有检测到付费标记」，不是「确认免费」。 */
    fee: 0
  }
}

/**
 * 一首歌在本层的 id：qishui:<数字别名>。
 *
 * 数字别名由主进程发，取流时再换回 19 位上游 id。字符串前缀让同一份队列里
 * 四个平台的 id 不会互相冒充。
 */
function trackIdFor(song: OnlineSong): string {
  return 'qishui:' + song.id
}

export function registerQishuiProvider(): void {
  registerProvider(qishuiProvider)
}
