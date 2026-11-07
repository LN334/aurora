import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { createQishuiApi, type QishuiApi } from 'qishui-music-api'
import { readState, writeState, clearSession } from './session'
import type { QishuiQuality, QishuiRawArtist, QishuiRawTrack } from './types'
import { write } from '../startup-log'

/**
 * 汽水的客户端。
 *
 * 与 QQ / 酷狗最大的不同：没有本地服务、没有 REST 端点可拼，全部请求都由
 * qishui-music-api 这个包完成。所以这一层只做四件事：
 *
 * 1. 按档案维护 SDK 实例与它的会话仓储（sessions 是包的契约，不是我们的）。
 * 2. 把上游的 19 位字符串 id 换成共享界面能用的数字 id（见下面的别名表）。
 * 3. 把上游的嵌套响应压成契约形状。
 * 4. 把 { ok, error } 结果翻成共享层的失败理由。
 */

interface TrackRef {
  kind: 'track'
  id: string
}
interface PlaylistRef {
  kind: 'playlist'
  id: string
  ownerId: string
}
interface ArtistRef {
  kind: 'artist'
  id: string
}
type Ref = TrackRef | PlaylistRef | ArtistRef

/**
 * 上游 id 是 19 位十进制数，超过 Number.MAX_SAFE_INTEGER，而共享界面按数字
 * 取 id。所以每一条引用在这里发一个稳定的 31 位别名。
 *
 * 别名由引用的字符串键做 FNV-1a 得到，不是递增计数器：重启之后同一个上游 id
 * 还是同一个别名，从磁盘恢复出来的队列因此仍然能取流。表本身也落盘，用来把
 * 别名换回上游 id —— FNV 是单向的，没有这张表就换不回去。
 */
const refs = new Map<number, Ref>()
const keys = new Map<string, number>()
let aliasesLoaded = false

const aliasFile = (): string => path.join(app.getPath('userData'), 'qishui-refs.json')

function loadAliases(): void {
  if (aliasesLoaded) return
  aliasesLoaded = true
  try {
    const file = aliasFile()
    if (!fs.existsSync(file)) return
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(raw)) return
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const alias = entry[0] as unknown
      const ref = entry[1] as unknown
      if (typeof alias !== 'number' || !ref || typeof ref !== 'object') continue
      const value = ref as Record<string, unknown>
      if (typeof value.id !== 'string') continue
      const kind = value.kind
      if (kind === 'track' || kind === 'artist') {
        refs.set(alias, { kind, id: value.id })
        keys.set(kind + ':' + value.id, alias)
      } else if (kind === 'playlist' && typeof value.ownerId === 'string') {
        refs.set(alias, { kind, id: value.id, ownerId: value.ownerId })
        keys.set('playlist:' + value.id + ':' + value.ownerId, alias)
      }
    }
  } catch {
    // 坏文件等于没有：别名会按需重新发一遍。
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveAliasesSoon(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      // 只留最近的一万条：这张表是缓存，不是档案，丢掉旧条目只会让很旧的队列
      // 取不到流，不会带走任何账号信息。
      const entries = [...refs.entries()].slice(-10000)
      fs.mkdirSync(path.dirname(aliasFile()), { recursive: true })
      fs.writeFileSync(aliasFile(), JSON.stringify(entries))
    } catch (error) {
      console.error('[aurora] 写汽水引用表失败', error instanceof Error ? error.message : String(error))
    }
  }, 800)
}

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function hashKey(key: string): number {
  let hash = FNV_OFFSET
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  // 收进正数范围：共享层的 id 会进 JSON，也会被当作字符串前缀的一部分。
  return ((hash >>> 0) % 2000000000) + 1
}

function aliasFor(ref: Ref): number {
  loadAliases()
  const key =
    ref.kind === 'playlist' ? 'playlist:' + ref.id + ':' + ref.ownerId : ref.kind + ':' + ref.id
  const known = keys.get(key)
  if (known !== undefined && refs.has(known)) return known
  const alias = hashKey(key)
  refs.set(alias, ref)
  keys.set(key, alias)
  saveAliasesSoon()
  return alias
}

function refOf(alias: number): Ref | null {
  loadAliases()
  return refs.get(alias) ?? null
}

/* ------------------------------------------------------------------ 客户端 */

let activeProfileId = 'default'
const apis = new Map<string, QishuiApi>()

/** 包要求的会话仓储：get/set/clear 同步，revision 每次写入都要变。 */
function sessionsFor(profileId: string) {
  const stored = readState(profileId)
  let session: unknown = stored.session
  let revision = 0
  return {
    deviceId: stored.deviceId,
    get revision() {
      return revision
    },
    get: () => session,
    set: (value: unknown) => {
      session = value
      revision += 1
      writeState(profileId, { session: value })
    },
    clear: () => {
      session = null
      revision += 1
      writeState(profileId, { session: null })
    }
  }
}

function apiFor(profileId: string): QishuiApi {
  const cached = apis.get(profileId)
  if (cached) return cached
  // 只取一次会话仓储，deviceId 用它自己那份：包会严格比对两者是否同一个。
  const sessions = sessionsFor(profileId)
  // deviceId 必须落盘，否则每次启动都算新设备，登录态与推荐全乱。
  writeState(profileId, { deviceId: sessions.deviceId })
  const api = createQishuiApi({
    deviceId: sessions.deviceId,
    sessions: sessions as never,
    fetch: globalThis.fetch,
    // 包的诊断只带主机名，不带地址与凭据，可以直接落启动日志。
    log: (message: string) => write('qishui: ' + message),
    warn: (message: string) => write('qishui WARN ' + message)
  })
  apis.set(profileId, api)
  return api
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/** 抖音 CDN 把封面拆成「前缀数组 + uri」两段。 */
function imageUrl(value: unknown): string | null {
  const raw = record(value)
  const urls = list(raw.urls)
  const base = typeof urls[0] === 'string' ? urls[0] : ''
  const uri = text(raw.uri)
  if (!base || !uri) return null
  return base + uri
}

function toRawTrack(item: unknown): QishuiRawTrack | null {
  const row = record(item)
  const base = record(row.base_info)
  const related = record(row.related_info)
  const display = record(row.display_info)
  const id = text(base.id) || text(row.id)
  if (!id) return null
  const album = record(related.album_link)
  const artists = list(related.artist_links).map((entry) => {
    const artist = record(entry)
    return { id: text(artist.id), name: text(artist.name) || text(artist.simple_display_name) }
  })
  const durationMs = typeof base.duration_ms === 'number' ? base.duration_ms : 0
  return {
    id,
    name: text(base.name),
    durationMs,
    albumId: text(album.id),
    albumName: text(album.name),
    artists: artists.filter((artist) => artist.name),
    coverUrl: imageUrl(display.cover_url)
  }
}

/* --------------------------------------------------------------- 契约形状 */

export interface QishuiAccountShape {
  id: string
  nickname: string
  avatarUrl: string | null
}

export interface QishuiSongShape {
  id: number
  mid: string
  name: string
  artists: { id: number; name: string }[]
  album: { id: number; name: string; picUrl: string | null }
  duration: number
  coverUrl: string | null
}

export interface QishuiPlaylistShape {
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  creator: string
}

export interface QishuiArtistShape {
  id: number
  name: string
  coverUrl: string | null
  description: string
  trackCount: number
}

function songShape(track: QishuiRawTrack): QishuiSongShape {
  return {
    id: aliasFor({ kind: 'track', id: track.id }),
    mid: track.id,
    name: track.name,
    artists: track.artists.map((artist) => ({
      id: aliasFor({ kind: 'artist', id: artist.id }),
      name: artist.name
    })),
    album: {
      id: aliasFor({ kind: 'artist', id: track.albumId || 'album:' + track.id }),
      name: track.albumName,
      picUrl: track.coverUrl
    },
    duration: Math.round(track.durationMs / 1000),
    coverUrl: track.coverUrl
  }
}

/** 登录后 login_status 的字段名没有文档，按几种常见写法读。 */
function accountOf(data: unknown): QishuiAccountShape | null {
  const root = record(data)
  const base = Object.keys(record(root.base_info)).length > 0 ? record(root.base_info) : root
  const user = Object.keys(record(base.user)).length > 0 ? record(base.user) : base
  const id = text(user.user_id) || text(user.uid) || text(user.id)
  if (!id) return null
  return {
    id,
    nickname: text(user.nickname) || text(user.name) || '汽水音乐用户',
    avatarUrl: imageUrl(user.avatar_url ?? user.avatar_thumb ?? user.avatar_medium)
  }
}

/** 失败理由：把包的错误码翻成共享层认识的那几个。 */
function reasonOf(code: string): 'auth-required' | 'vip-required' | 'unavailable' | 'network' {
  if (code === 'auth-required') return 'auth-required'
  if (code === 'vip-required' || code === 'preview-only') return 'vip-required'
  if (code === 'network' || code === 'upstream') return 'network'
  return 'unavailable'
}

/* -------------------------------------------------------------------- 对外 */

export function setActiveProfile(profileId: string): boolean {
  activeProfileId = profileId || 'default'
  return true
}

export function activeProfile(): string {
  return activeProfileId
}

export async function qishuiStatus(): Promise<{ ready: boolean; loggedIn: boolean; detail?: string }> {
  const profileId = activeProfileId
  const signedIn = readState(profileId).session !== null
  return {
    ready: true,
    loggedIn: signedIn,
    detail: signedIn ? undefined : '未登录也能搜索和播放免费歌曲'
  }
}

export async function qishuiLoginStatus(): Promise<QishuiAccountShape | null> {
  const result = (await apiFor(activeProfileId).request('login_status', {})) as {
    ok?: boolean
    data?: unknown
  }
  // 未登录时上游答 data:null；真正的错误（网络等）在这里也算「没有人」，
  // 界面于是显示未登录而不是一个永久的加载态。
  if (!result.ok) return null
  return accountOf(result.data)
}

export async function qishuiQrCreate(): Promise<{ key: string; imageDataUrl: string }> {
  const api = apiFor(activeProfileId)
  const keyResult = (await api.request('login_qr_key', {})) as {
    ok?: boolean
    data?: { key?: string }
    error?: { code?: string; message?: string }
  }
  const key = keyResult.ok ? keyResult.data?.key : undefined
  if (!key) {
    write('qishui:qrCreate 没有拿到 key ' + (keyResult.error?.code ?? ''))
    return { key: '', imageDataUrl: '' }
  }
  const created = (await api.request('login_qr_create', { key })) as {
    ok?: boolean
    data?: { imageUrl?: string }
    error?: { code?: string }
  }
  if (!created.ok || !created.data?.imageUrl) {
    write('qishui:qrCreate 二维码生成失败 ' + (created.error?.code ?? ''))
    return { key: '', imageDataUrl: '' }
  }
  return { key, imageDataUrl: created.data.imageUrl }
}

export async function qishuiQrCheck(key: string): Promise<{
  status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
  account?: QishuiAccountShape
  message?: string
}> {
  if (!key) return { status: 'failed', message: '没有二维码' }
  const api = apiFor(activeProfileId)
  const result = (await api.request('login_qr_check', { key })) as {
    ok?: boolean
    data?: { state?: string }
    error?: { code?: string; message?: string }
  }
  if (!result.ok) {
    const code = result.error?.code ?? ''
    // 二维码过期的上游错误码不固定，按文案与码一起判。
    if (code === 'expired' || /expire/i.test(result.error?.message ?? '')) {
      return { status: 'expired', message: '二维码已过期' }
    }
    write('qishui:qrCheck 失败 ' + code + ' ' + (result.error?.message ?? ''))
    return { status: 'failed', message: result.error?.message }
  }
  const state = result.data?.state ?? 'waiting'
  if (state === 'confirmed') {
    const account = await qishuiLoginStatus()
    return { status: 'confirmed', account: account ?? undefined }
  }
  if (state === 'scanned') return { status: 'scanned' }
  if (state === 'expired') return { status: 'expired', message: '二维码已过期' }
  return { status: 'waiting' }
}

export async function qishuiLogout(): Promise<boolean> {
  const profileId = activeProfileId
  try {
    await apiFor(profileId).request('logout', {})
  } catch {
    // 注销失败也要清本地会话：用户点了退出，本地就不该再拿着凭据。
  }
  clearSession(profileId)
  return true
}

export async function qishuiSearch(
  keywords: string,
  limit: number
): Promise<{ songs: QishuiSongShape[] }> {
  const api = apiFor(activeProfileId)
  const result = (await api.request('search', { query: keywords, limit, offset: 0 })) as {
    ok?: boolean
    data?: { items?: unknown[] }
    error?: { code?: string }
  }
  if (!result.ok) {
    write('qishui:search 失败 ' + (result.error?.code ?? ''))
    return { songs: [] }
  }
  const songs: QishuiSongShape[] = []
  for (const item of list(result.data?.items)) {
    const track = toRawTrack(item)
    if (track) songs.push(songShape(track))
  }
  return { songs }
}

export async function qishuiSong(alias: number): Promise<QishuiSongShape | null> {
  const ref = refOf(alias)
  if (!ref || ref.kind !== 'track') return null
  const result = (await apiFor(activeProfileId).request('song_detail', { id: ref.id })) as {
    ok?: boolean
    data?: unknown
  }
  if (!result.ok) return null
  const track = toRawTrack(result.data)
  return track ? songShape(track) : null
}

export async function qishuiStreamUrl(
  alias: number,
  quality: QishuiQuality
): Promise<
  | { ok: true; url: string; level: QishuiQuality; trial: boolean; br: number }
  | { ok: false; reason: string; message?: string }
> {
  const ref = refOf(alias)
  if (!ref || ref.kind !== 'track') {
    return { ok: false, reason: 'unavailable', message: '这首歌不在本次会话里' }
  }
  const result = (await apiFor(activeProfileId).request('audio', {
    id: ref.id,
    quality
  })) as {
    ok?: boolean
    data?: { url?: string; quality?: QishuiQuality; preview?: boolean }
    error?: { code?: string; message?: string }
  }
  if (!result.ok || !result.data?.url) {
    const code = result.error?.code ?? ''
    return {
      ok: false,
      reason: reasonOf(code),
      message: result.error?.message ?? '汽水没有给出播放地址'
    }
  }
  return {
    ok: true,
    url: result.data.url,
    level: result.data.quality ?? quality,
    trial: result.data.preview === true,
    /*
     * 汽水（抖音）不报码率：接口给的是一段 m4a。共享播放器要一个数字才肯
     * 画「无损/320k」那种标签，这里按 128k 报——比编一个 320k 诚实。
     */
    br: 128000
  }
}

export async function qishuiMyPlaylists(limit: number): Promise<QishuiPlaylistShape[]> {
  const result = (await apiFor(activeProfileId).request('user_playlists', {
    limit,
    offset: 0
  })) as {
    ok?: boolean
    data?: { items?: unknown[]; playlists?: unknown[] }
    error?: { code?: string }
  }
  if (!result.ok) return []
  const rows = list(result.data?.items ?? result.data?.playlists)
  const out: QishuiPlaylistShape[] = []
  for (const row of rows) {
    const base = record(record(row).base_info)
    const id = text(base.id)
    if (!id) continue
    const ownerId = text(base.owner_id)
    out.push({
      id: aliasFor({ kind: 'playlist', id, ownerId }),
      name: text(base.title) || text(base.name) || '未命名歌单',
      coverUrl: imageUrl(base.cover_url),
      trackCount: typeof base.track_count === 'number' ? base.track_count : 0,
      creator: text(record(base.owner).nickname) || text(base.owner_name)
    })
  }
  return out
}

export async function qishuiPlaylistTracks(alias: number): Promise<QishuiSongShape[]> {
  const ref = refOf(alias)
  if (!ref || ref.kind !== 'playlist') return []
  const result = (await apiFor(activeProfileId).request('playlist_tracks', {
    id: ref.id,
    ownerId: ref.ownerId,
    limit: 500,
    offset: 0
  })) as { ok?: boolean; data?: { items?: unknown[] }; error?: { code?: string } }
  if (!result.ok) {
    write('qishui:playlistTracks 失败 ' + (result.error?.code ?? ''))
    return []
  }
  const songs: QishuiSongShape[] = []
  for (const item of list(result.data?.items)) {
    const track = toRawTrack(item)
    if (track) songs.push(songShape(track))
  }
  return songs
}

export async function qishuiArtistProfile(alias: number): Promise<QishuiArtistShape | null> {
  const ref = refOf(alias)
  if (!ref || ref.kind !== 'artist') return null
  const result = (await apiFor(activeProfileId).request('artist_detail', { id: ref.id })) as {
    ok?: boolean
    data?: { base_info?: unknown }
  }
  if (!result.ok) return null
  const base = record(result.data?.base_info)
  const id = text(base.id) || ref.id
  return {
    id: aliasFor({ kind: 'artist', id }),
    name: text(base.name) || text(base.full_display_name),
    coverUrl: imageUrl(base.url_avatar),
    description: text(base.intro),
    trackCount: typeof base.count_tracks === 'number' ? base.count_tracks : 0
  }
}

export async function qishuiArtistSongs(alias: number, limit: number): Promise<QishuiSongShape[]> {
  const ref = refOf(alias)
  if (!ref || ref.kind !== 'artist') return []
  const result = (await apiFor(activeProfileId).request('artist_songs', {
    id: ref.id,
    limit,
    offset: 0
  })) as { ok?: boolean; data?: { items?: unknown[] } }
  if (!result.ok) return []
  const songs: QishuiSongShape[] = []
  for (const item of list(result.data?.items)) {
    const track = toRawTrack(item)
    if (track) songs.push(songShape(track))
  }
  return songs
}

export function rawArtist(id: string): QishuiRawArtist {
  return { id, name: '', coverUrl: null, description: '', trackCount: 0 }
}
