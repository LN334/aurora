import { errorText } from '../pure/error-text.ts'
import type { NeteaseAlbumRef, NeteaseArtist, NeteaseSong } from './types'

// --- untrusted-response readers -------------------------------------------

type Json = Record<string, unknown>

export function asRecord(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export const asNullableString = (value: unknown): string | null => asString(value) || null

/** `body.data` when upstream wraps its payload, otherwise `body` itself. */
export function payloadOf(body: unknown): Json {
  const record = asRecord(body)
  const data = record.data
  return data && typeof data === 'object' && !Array.isArray(data) ? asRecord(data) : record
}

export function readable(error: unknown): string {
  return errorText(error)
}

// --- normalisation --------------------------------------------------------

/**
 * Upstream spells the same song three ways depending on the endpoint
 * (`ar`/`al` on search and detail, `artists`/`album` on older routes, and
 * `simpleSong` on cloud files), so everything funnels through one mapper.
 */
export function toSong(value: unknown): NeteaseSong | null {
  const raw = asRecord(value)
  const id = asNumber(raw.id)
  if (!id) return null

  const artistSource = asArray(raw.ar).length > 0 ? asArray(raw.ar) : asArray(raw.artists)
  const artists: NeteaseArtist[] = artistSource
    .map((entry) => ({ id: asNumber(asRecord(entry).id), name: asString(asRecord(entry).name) }))
    .filter((artist) => artist.name.length > 0)

  const albumSource = asRecord(raw.al ?? raw.album)
  const album: NeteaseAlbumRef = {
    id: asNumber(albumSource.id),
    name: asString(albumSource.name),
    picUrl: asNullableString(albumSource.picUrl)
  }

  return {
    id,
    name: asString(raw.name) || '未知歌曲',
    artists,
    album,
    // Upstream durations are milliseconds everywhere; the contract is seconds.
    duration: Math.round(asNumber(raw.dt) / 1000),
    fee: asNumber(raw.fee)
  }
}

export function toSongs(value: unknown): NeteaseSong[] {
  return asArray(value)
    .map(toSong)
    .filter((song): song is NeteaseSong => song !== null)
}

export const joinArtists = (value: unknown): string =>
  asArray(value)
    .map((entry) => asString(asRecord(entry).name))
    .filter(Boolean)
    .join(' / ')

export const yearOf = (publishTime: unknown): number | null => {
  const ms = asNumber(publishTime)
  if (ms <= 0) return null
  const year = new Date(ms).getFullYear()
  return Number.isFinite(year) ? year : null
}

export const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min
