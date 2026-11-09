import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { createQishuiApi, type QishuiApi } from 'qishui-music-api'
import { readState, writeState, clearSession } from './session'
import type { QishuiQuality, QishuiRawTrack } from './types'
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

/**
 * 抖音 CDN 把封面拆成「前缀数组 + uri」两段，而且**光拼两段会 400**。
 *
 * 实测（2026-11）：`https://p3-luna.douyinpic.com/img/tos-cn-i-xxxx/<hash>` 直连
 * 返回 `{"code":2004,"error":"fail to handle request"}`；后面补上模板后缀才出图：
 * `~tplv-xxxx-image.image` 是原图，`~tplv-xxxx-resize:360:360.jpeg` 是缩略图。
 * 模板前缀就在同一个对象里（`template_prefix`），所以这里自己拼。
 */
function imageUrl(value: unknown, size = 360): string | null {
  const raw = record(value)
  const urls = list(raw.urls)
  const base = typeof urls[0] === 'string' ? urls[0] : ''
  const uri = text(raw.uri)
  if (!base || !uri) return null
  const template = text(raw.template)
  if (template) return base + uri + (template.startsWith('~') ? template : '~' + template)
  const prefix = text(raw.template_prefix)
  if (!prefix) return base + uri
  return `${base}${uri}~tplv-${prefix.replace(/^tplv-/, '')}-resize:${size}:${size}.jpeg`
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

interface QishuiAccountShape {
  id: string
  nickname: string
  avatarUrl: string | null
}

interface QishuiSongShape {
  id: number
  mid: string
  name: string
  artists: { id: number; name: string }[]
  album: { id: number; name: string; picUrl: string | null }
  duration: number
  coverUrl: string | null
}

interface QishuiPlaylistShape {
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  creator: string
}

interface QishuiArtistShape {
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

/**
 * 推荐流。
 *
 * 汽水的个性化接口（recent_played / liked_songs）未登录一律答 auth-required，
 * 唯独 `feed` 游客也发——一次 30 首、按场景编好，掺的正是没收藏过的东西，
 * 所以它是这个平台唯一能进「漫游」的入口。
 */
export async function qishuiFeed(limit: number): Promise<QishuiSongShape[]> {
  const api = apiFor(activeProfileId)
  const result = (await api.request('feed', {})) as {
    ok?: boolean
    data?: { items?: unknown[] }
    error?: { code?: string }
  }
  if (!result.ok) {
    write('qishui:feed 失败 ' + (result.error?.code ?? ''))
    return []
  }
  const songs: QishuiSongShape[] = []
  for (const item of list(result.data?.items)) {
    if (songs.length >= limit) break
    const track = toRawTrack(item)
    if (track) songs.push(songShape(track))
  }
  return songs
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

/**
 * 汽水的「我喜欢」。
 *
 * 上游这个操作不带参数，只认登录态：未登录直接回 auth-required。这里把它压成
 * 空列表——账号页已经说明登录能多出什么，比在列表里挂一行报错有用。
 */
export async function qishuiLiked(limit = 200): Promise<QishuiSongShape[]> {
  const result = (await apiFor(activeProfileId).request('liked_songs', {})) as {
    ok?: boolean
    data?: { items?: unknown[]; songs?: unknown[]; list?: unknown[] }
    error?: { code?: string }
  }
  if (!result.ok) return []
  const rows = list(result.data?.items ?? result.data?.songs ?? result.data?.list)
  const songs: QishuiSongShape[] = []
  for (const item of rows) {
    const track = toRawTrack(item)
    if (track) songs.push(songShape(track))
    if (songs.length >= limit) break
  }
  return songs
}

/**
 * 收藏／取消收藏一首歌。
 *
 * 汽水这边「喜欢」就是账号里的一个收藏动作，写回之后平台自己的客户端也会变——
 * 这是用户在 Aurora 点红心时的期待。id 是别名，先用 refOf 换回上游字符串。
 */
export async function qishuiLike(alias: number, liked: boolean): Promise<boolean> {
  const ref = refOf(alias)
  if (!ref || ref.kind !== 'track') return false
  const result = (await apiFor(activeProfileId).request('like_song', {
    id: ref.id,
    liked
  })) as { ok?: boolean; error?: { code?: string } }
  return result.ok === true
}

/**
 * 往自己的歌单里加歌／移出歌。
 *
 * 上游只给了这两个动作：不能建单、不能改名、不能删单（见 qishui-music-api 的
 * QishuiOperation），所以汽水没有 `create / rename / remove` 这三支可挂。
 */
export async function qishuiPlaylistTracksEdit(
  alias: number,
  songAliases: number[],
  add: boolean
): Promise<boolean> {
  const ref = refOf(alias)
  if (!ref || ref.kind !== 'playlist') return false
  const ids: string[] = []
  for (const songAlias of songAliases) {
    const song = refOf(songAlias)
    if (song && song.kind === 'track') ids.push(song.id)
  }
  if (ids.length === 0) return false
  const result = (await apiFor(activeProfileId).request(
    add ? 'playlist_add_tracks' : 'playlist_remove_tracks',
    { id: ref.id, ids }
  )) as { ok?: boolean; error?: { code?: string } }
  return result.ok === true
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
    write('qishui:plkeys ' + Object.keys(base).join(','))
    out.push({
      id: aliasFor({ kind: 'playlist', id, ownerId }),
      name: text(base.title) || text(base.name) || '未命名歌单',
      coverUrl: imageUrl(base.cover_url ?? base.cover ?? base.pic_url ?? base.pic),
      trackCount: typeof base.track_count === 'number' ? base.track_count : 0,
      creator: text(record(base.owner).nickname) || text(base.owner_name)
    })
  }
  return out
}

/**
 * 公开歌单搜索。
 *
 * 首页推荐位要的是「平台推荐了什么」，汽水的推荐流（feed）要登录，但公开歌单
 * 搜索不需要账号 —— 用热词捞一批，就是它这一侧能给的推荐。
 */
/**
 * 歌单封面藏在 display_info.url_cover 里，形状与歌曲封面同源：
 * 要么直接给一串地址，要么给 { urls:[cdn], uri:'后缀' } 这种两段式。
 */
function playlistCover(row: unknown): string | null {
  const display = record(record(row).display_info)
  const raw = display.url_cover ?? display.cover_url ?? display.cover
  if (typeof raw === 'string' && raw) return raw
  /*
   * 真实的封面是 { urls: ['https://p3-luna.douyinpic.com/img/'], uri: 'tos-cn-...' }
   * 这种两段式。imageUrl 认得这个形状，会拼成绝对地址。
   *
   * 注意不要把「已经拼好的字符串」再喂给 imageUrl：它只认对象，字符串进去会
   * 读出空前缀和空 uri，返回 null —— 上一版整批封面为空就是这个原因。
   */
  const twoPart = imageUrl(raw)
  if (twoPart) return twoPart
  const fallback = imageUrl(record(row).cover_url ?? record(row).cover ?? record(row).pic)
  if (!fallback) write('qishui:plcover miss keys=' + Object.keys(record(row)).join(','))
  return fallback
}

export async function qishuiSearchPlaylists(
  query: string,
  limit: number
): Promise<QishuiPlaylistShape[]> {
  const result = (await apiFor(activeProfileId).request('search_playlists', {
    query,
    limit,
    offset: 0
  })) as { ok?: boolean; data?: { items?: unknown[] }; error?: { code?: string } }
  if (!result.ok) {
    write('qishui:searchPlaylists 失败 ' + (result.error?.code ?? ''))
    return []
  }
  const out: QishuiPlaylistShape[] = []
  for (const row of list(result.data?.items)) {
    // 搜索结果有的版本把歌单包在 playlist_entity 里，有的直接给 base_info。
    const entity = record(record(row).playlist_entity)
    const base = Object.keys(entity).length > 0 ? record(entity.base_info) : record(record(row).base_info)
    const id = text(base.id)
    if (!id) continue
    const ownerId = text(base.owner_id)
    out.push({
      id: aliasFor({ kind: 'playlist', id, ownerId }),
      name: text(base.title) || text(base.name) || '未命名歌单',
      /*
       * 搜索结果把封面放在 playlist_entity.display_info 里，不在最外层。之前
       * 传的是 row，取到的 display_info 是空的，整批封面都是 null。
       */
      coverUrl: playlistCover(Object.keys(entity).length > 0 ? entity : row),
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
