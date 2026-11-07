import type { KugouFailureReason } from './reasons'

export type { KugouFailureReason }

/**
 * 酷狗音乐的形状，跨 bridge 的那一份。
 *
 * `src/env.d.ts` 手工镜像这些类型，改一边不改另一边就是 bug——和 QQ 那套一样。
 *
 * 三处由渲染层决定，不是随意命名：
 *   * 共享的 `normalizeSong` 读 `song.id`（数字）、`song.artists[]`、`song.album`、
 *     `song.duration`（秒）与 `song.fee`，所以这里都给全。
 *   * 播放身份不是 `id`：酷狗取流要 `hash` + `album_id` + `album_audio_id`（实测
 *     `/song/url` 的入参），数字 id 只是界面钥匙，跟着一起带上。
 *   * `name` 在歌单曲目里是「歌手 - 歌名」的合体字符串（实测），读的时候拆开，
 *     但两个来源都留：拆出来的歌手名给列表画，原始串不再用。
 */

/**
 * 与网易云/QQ 同一套音质词汇。
 *
 * 酷狗的档位是 128/320/flac 三档（实测曲目里 `relate_goods` 只列这三档），
 * 映射在 `transport.ts` 里做，页面只认这四档。
 */
export type KugouQuality = 'standard' | 'higher' | 'exhigh' | 'lossless'

const KUGOU_QUALITIES: readonly KugouQuality[] = ['standard', 'higher', 'exhigh', 'lossless']

export function isKugouQuality(value: unknown): value is KugouQuality {
  return typeof value === 'string' && (KUGOU_QUALITIES as readonly string[]).includes(value)
}

export interface KugouArtist {
  /** 数字 `singerinfo[].id`。 */
  id: number
  name: string
  /** 歌手头像；上游给了就带，没给是 null。 */
  avatar: string | null
}

export interface KugouAlbumRef {
  /** `AlbumID` 是字符串（实测 `'966846'`），取流时要原样传回，所以不转数字。 */
  id: string
  name: string
  picUrl: string | null
}

export interface KugouSong {
  /** 数字 `Audioid`/`audio_id`，共享形状与列表都用它当钥匙。 */
  id: number
  /** `id` 的别名，共享归一化器也找 `songId`。 */
  songId: number
  /** 128k 的 `FileHash`/`hash`，取流的必填项。 */
  hash: string
  /** 320k 的 `HQFileHash`（歌单曲目从 `relate_goods` 里取）；没有是空串。 */
  hqHash: string
  /** 无损的 `SQFileHash`；没有是空串。 */
  sqHash: string
  /** `MixSongID`/`mixsongid`，取流的 `album_audio_id`。 */
  albumAudioId: string
  /** `AlbumID`/`album_id`，取流的 `album_id`。 */
  albumId: string
  name: string
  artists: KugouArtist[]
  album: KugouAlbumRef
  /** 秒。上游搜索给 `Duration`（秒），歌单曲目给 `timelen`（毫秒）。 */
  duration: number
  /**
   * 共享形状的 `fee`：1 表示目录标了付费。
   *
   * 酷狗的 `privilege`/`pay_type` 位语义没有可信文档（实测同一批免费歌
   * `privilege=10`），**不按位解释**，只把能确定的「有付费标记」当提示。
   * 真正的判决在取流时由上游给出。
   */
  fee: number
  paid: boolean
}

export interface KugouStream {
  /** 上游 http(s) 地址，经 `aurora-remote:` 播放，页面不直接碰酷狗域名。 */
  url: string
  /** 请求的档位。 */
  quality: KugouQuality
  /** 实际拿到的档位（上游可能只有低档）。 */
  level: KugouQuality
  /** kbps；999 是本项目表示无损的既有约定。 */
  br: number
  lossless: boolean
  /** 酷狗不给试听片段，恒 false。 */
  trial: boolean
}

export type KugouStreamResult =
  | ({ ok: true } & KugouStream)
  | { ok: false; reason: KugouFailureReason; message?: string }

export interface KugouSearchResult {
  songs: KugouSong[]
  /**
   * 恒为空数组。
   *
   * 酷狗的 `/search/song` 只返回歌曲列表（实测），没有专辑/歌手搜索；这里保留
   * 字段只为满足共享搜索结果形状，而不是假装有。
   */
  albums: {
    id: number
    name: string
    artist: string
    picUrl: string | null
    year: number | null
    songCount: number
  }[]
  artists: { id: number; name: string; picUrl: string | null; albumCount: number }[]
}

export interface KugouAccount {
  /** 数字 `userid`。 */
  id: number
  nickname: string
  avatarUrl: string | null
}

export interface KugouStatusResult {
  ready: boolean
  loggedIn: boolean
  detail?: string
}

/** 一张待扫的二维码：轮询用的钥匙 + 直接放进 `<img>` 的 data URL。 */
export interface KugouQrSession {
  key: string
  imageDataUrl: string
}

export interface KugouQrResult {
  status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
  account?: KugouAccount
  message?: string
}

/**
 * 「我的歌单」一行。
 *
 * 酷狗的歌单身份是 `global_collection_id` 字符串（实测 `collection_3_1508839047_189_0`），
 * 而共享界面按正整数取歌单，所以主进程给每张歌单发一个本次会话稳定的数字别名，
 * `id` 是别名，真身份留在主进程里。
 */
export interface KugouPlaylistSummary {
  /** 主进程分配的别名（正整数），`playlistTracks` 认它。 */
  id: number
  name: string
  coverUrl: string | null
  /** 0 表示上游没报，不是空歌单。 */
  trackCount: number
  creator: string
}
