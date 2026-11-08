/**
 * The shapes that cross the bridge, mirroring the netease section of
 * `src/env.d.ts`.
 *
 * They are declared twice on purpose. `src/env.d.ts` is the contract the
 * renderer compiles against and must stay free of main-process imports, while
 * `tsconfig.electron.json` only sees `electron/**` - so the two files are kept
 * in step by hand, the same way `electron/updates.ts` and `UpdateResult` are.
 * Changing a field here without changing `src/env.d.ts` is a bug.
 */

import type { NeteaseFailureReason } from './reasons'

export type { NeteaseFailureReason }

export interface NeteaseArtist {
  id: number
  name: string
}

export interface NeteaseAlbumRef {
  id: number
  name: string
  picUrl: string | null
}

export interface NeteaseSong {
  id: number
  name: string
  artists: NeteaseArtist[]
  album: NeteaseAlbumRef
  /** Seconds; upstream reports milliseconds. */
  duration: number
  /** Upstream `fee`: 0 free, 1 VIP, 4 paid album, 8 low-quality free. */
  fee: number
}

export type NeteaseQuality = 'standard' | 'higher' | 'exhigh' | 'lossless'

export const NETEASE_QUALITIES: readonly NeteaseQuality[] = [
  'standard',
  'higher',
  'exhigh',
  'lossless'
]

export function isNeteaseQuality(value: unknown): value is NeteaseQuality {
  return typeof value === 'string' && (NETEASE_QUALITIES as readonly string[]).includes(value)
}

/**
 * Whether a number can be an upstream id at all.
 *
 * Zero is not a theoretical case: search results for user-uploaded covers list
 * an artist whose `id` is 0, and upstream answers `id: 0` - like any other
 * nonsense - with a 404 envelope that the package *throws* rather than returns.
 * Every single-id entry point checks this first, so a bad id becomes an empty
 * answer instead of a failed request that takes a whole panel down.
 *
 * `Number.isSafeInteger` rather than `Number.isInteger`: an id past 2^53 cannot
 * survive the JSON round trip to upstream as the same number, so forwarding one
 * would earn exactly the 404 this guard exists to prevent.
 *
 * It lives here, next to the quality guard, because this is the one module in
 * `electron/netease/` that imports nothing: `client.ts` pulls in the Electron
 * `safeStorage` vault through `session.ts`, so a unit test cannot load it.
 */
export function isUsableId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0
}

export interface NeteaseStream {
  /** Upstream http(s) URL. Played through `aurora-remote:`, never fetched by the page. */
  url: string
  /** kbps */
  br: number
  level: NeteaseQuality | 'hires'
  /** Seconds of what this URL actually delivers; 0 when upstream does not say. */
  duration: number
  trial: boolean
  trialFrom?: number
  trialTo?: number
}

export type NeteaseStreamResult =
  | { ok: true; stream: NeteaseStream }
  | { ok: false; reason: NeteaseFailureReason; message?: string }

export interface NeteasePlaylistSummary {
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  playCount: number
  creator: string
  subscribed: boolean
}

/** Which front-page block a discover request fills. */
export type NeteaseDiscoverKind = 'newsongs' | 'playlists' | 'quality'

/**
 * A playlist card on the discover page.
 *
 * Separate from `NeteasePlaylistSummary` because that one is "a playlist the
 * account owns" and carries a `subscribed` flag, while a recommended card has
 * no owner and instead carries upstream's one-line pitch (`copywriter`). The
 * two shapes would drift apart if merged.
 */
export interface NeteaseDiscoverPlaylist {
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  playCount: number
  /** Editor or owner nickname; empty on the personalised route, which omits it. */
  creator: string
  /** Upstream's short pitch, when the route sends one. */
  note: string
}

/** One discover block. Exactly one of the two lists is populated. */
export interface NeteaseDiscoverResult {
  kind: NeteaseDiscoverKind
  songs: NeteaseSong[]
  playlists: NeteaseDiscoverPlaylist[]
}

export interface NeteaseAccount {
  userId: number
  nickname: string
  avatarUrl: string | null
  vip: boolean
  level: number
}

export interface NeteaseAlbum {
  id: number
  name: string
  artist: string
  /** 专辑页里点艺人名要跳页，所以带上这个人的 id。 */
  artistId: number | null
  coverUrl: string | null
  year: number | null
  /** 专辑简介。上游两个字段都见过，取到哪个算哪个，都没有就是空串。 */
  description: string
  songs: NeteaseSong[]
}

/** 艺人页的三块内容：这个人是谁、他全部的歌、他的专辑。 */
export interface NeteaseArtistDetail {
  id: number
  name: string
  coverUrl: string | null
  briefDesc: string
  albumCount: number
  songCount: number
}

export interface NeteaseCollectedAlbum {
  id: number
  name: string
  coverUrl: string | null
  artistName: string
  /** 专辑艺人的平台 id；上游没给时是 0。带它卡片上的名字才点得进艺人页。 */
  artistId: number
  year: number
  songCount: number
}

export interface NeteaseAlbumSummary {
  id: number
  name: string
  coverUrl: string | null
  year: number | null
  songCount: number
}

export interface NeteaseSearchResult {
  songs: NeteaseSong[]
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

 type NeteaseQrStatus = 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'

/** Upstream availability, as `netease:status` reports it. */
export interface NeteaseStatusResult {
  ready: boolean
  loggedIn: boolean
  detail?: string
}

export interface NeteaseLyricsResult {
  lrc: string | null
  translation: string | null
}

/** A pending QR login: the key to poll with, the URL and a rendered PNG. */
export interface NeteaseQrSession {
  key: string
  url: string
  imageDataUrl: string
}

export interface NeteaseQrResult {
  status: NeteaseQrStatus
  account?: NeteaseAccount
  message?: string
}

export interface NeteaseLoginResult {
  ok: boolean
  account?: NeteaseAccount
  message?: string
}
