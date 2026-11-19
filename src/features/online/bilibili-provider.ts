import type { BilibiliQuality, BilibiliVideo } from '../../env'
import type { Track } from '../../types'
import type { QualityTier } from './types'
import { registerProvider } from './registry'
import type { PlatformBackend } from './store'
import {
  unknownAvailability,
  type OnlineMusicProvider,
  type OnlineSong
} from './types'

/**
 * B 站。
 *
 * 它不是音乐平台：一条结果就是一个视频，所谓「歌」就是视频里那条 DASH 音频轨。
 * 所以这里只挂搜索、播放与登录三件事，其余（歌单、专辑、艺人、歌词）一个都不
 * 声明——缺方法就是「这家没有这一页」，界面因此不会摆一个点进去空白的入口。
 *
 * 登录是可选的：匿名能搜能播，登录换来的是搜索不容易被风控挡下，以及更高档的
 * 音频轨。所以界面上「未登录」不是错误状态，只是还没有那个加成。
 */

const TIERS: QualityTier[] = ['standard', 'higher', 'exhigh', 'lossless', 'hires']

/** 本次运行选的档位；B 站没有账号，也不存偏好，重启回 exhigh。 */
let chosenTier: QualityTier = 'exhigh'

function client() {
  const bridge = typeof window === 'undefined' ? undefined : window.aurora?.bilibili
  return bridge ?? null
}

/** 视频 -> 共享歌曲形状。作者当艺人，视频标题当歌名，封面取 pic。 */
function asOnlineSong(video: BilibiliVideo): OnlineSong {
  return {
    id: video.aid,
    name: video.title,
    artists: video.author ? [{ id: 0, name: video.author }] : [],
    album: { id: 0, name: 'B 站视频', picUrl: video.cover },
    duration: video.duration,
    // B 站没有 fee 概念：能播就是能播，播放地址那条请求才是真正的判决。
    fee: 0,
    mid: video.bvid
  }
}

const bilibiliBackend: PlatformBackend = {
  id: 'bilibili',
  displayName: 'B 站',

  async getQuality() {
    return chosenTier as BilibiliQuality
  },

  async setQuality(quality) {
    chosenTier = quality
    return chosenTier as BilibiliQuality
  },

  async search(keywords, _kind, limit) {
    const result = await client()?.search(keywords, limit ?? 30)
    const videos = result?.videos ?? []
    return { songs: videos.map(asOnlineSong), albums: [], artists: [] }
  },

  /*
   * 上游没有「按 aid 查一首」的接口，搜索是唯一来源。如实答 null：共享状态机
   * 随后会说「这首歌查不到」，而不是凭 id 编一个标题出来。
   */
  async songById() {
    return null
  },

  toTrack(song) {
    const id = 'bilibili:' + song.id
    return {
      id,
      path: id,
      source: 'bilibili',
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
      // B 站的 DASH 音频是 AAC（m4a），不是 mp3。
      codec: 'm4a',
      lossless: false,
      size: 0,
      mtimeMs: 0,
      addedAt: Date.now(),
      hasArt: Boolean(song.album.picUrl),
      coverUrl: song.album.picUrl ?? undefined,
      onlineId: song.id,
      albumId: undefined,
      artistId: undefined,
      artistRefs: song.artists.map((item) => ({ id: item.id || 0, name: item.name })),
      gainDb: null,
      peak: null
    }
  },

  songIdOf(track: Track) {
    if (track.source !== 'bilibili') return null
    const id = Number(track.id.slice('bilibili:'.length))
    return Number.isFinite(id) ? id : null
  },

  async streamUrl(songId, quality) {
    const result = await client()?.streamUrl(songId, quality as BilibiliQuality)
    if (!result) return { ok: false, reason: 'service-unavailable' }
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message }
    return {
      ok: true,
      stream: {
        url: result.stream.url,
        br: result.stream.br,
        level: result.stream.level,
        duration: result.stream.duration,
        trial: result.stream.trial
      }
    }
  },

  async loginStatus() {
    const account = await client()?.loginStatus()
    if (!account) return null
    return {
      id: account.mid,
      nickname: account.nickname,
      avatarUrl: account.face || null,
      vip: account.vip,
      level: account.level
    }
  },

  async logout() {
    await client()?.logout()
  },

  async bindProfile(profileId) {
    // 登录态按档案分槽存：换档案时主进程要跟着换那份 cookie。
    await client()?.setProfile(profileId)
  }
}

const bilibiliProvider: OnlineMusicProvider = {
  id: 'bilibili',
  displayName: 'B 站',
  shortName: 'B 站',
  summary: '把 B 站视频当歌听：搜索、播放它 DASH 里的音频轨，最高 192k',
  disclosure:
    '通过 B 站公开的 web 接口接入（WBI 签名 + playurl），仅供个人学习自用；不提供绕过会员或大会员的能力。',
  anonymousNote: '无需登录：搜索与播放都走公开接口，匿名即可。',
  available: () => client() !== null,
  capabilities: {
    search: true,
    playback: true,
    // 视频没有结构化歌词，硬凑一份只会是错的。
    lyrics: false,
    auth: true,
    playlists: false,
    albums: false,
    artists: false,
    recommendations: false,
    userCloud: false,
    likes: false
  },
  qualityTiers: TIERS,
  getQuality: () => bilibiliBackend.getQuality(),
  setQuality: (quality) => bilibiliBackend.setQuality(quality),
  search: {
    search: (keywords, kind, limit) =>
      bilibiliBackend.search(keywords, kind, limit ?? 30) as Promise<{ songs: OnlineSong[]; albums: never[]; artists: never[] }>
  },
  playback: {
    streamUrl: (songId, quality) => bilibiliBackend.streamUrl(songId, quality ?? 'exhigh'),
    getAvailability: () => unknownAvailability('B 站视频能不能播，以取流结果为准')
  },
  backend: bilibiliBackend
}

export function registerBilibiliProvider(): void {
  registerProvider(bilibiliProvider)
}
