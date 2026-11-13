import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyStreamFailure, describeFailure } from './reasons'
import type { NeteaseFailureReason } from './reasons'
import {
  HANDSHAKE_BACKOFF_MS,
  HANDSHAKE_COOLDOWN_MS,
  isTransientHandshakeFailure
} from '../pure/netease-bootstrap'
import { clearCookie, hasCookie, readCookie, writeCookie } from './session'
import { isUsableId } from './types'
import type {
  NeteaseAccount,
  NeteaseAlbum,
  NeteaseAlbumRef,
  NeteaseAlbumSummary,
  NeteaseArtist,
  NeteaseArtistDetail,
  NeteaseCollectedAlbum,
  NeteaseDiscoverKind,
  NeteaseDiscoverPlaylist,
  NeteaseDiscoverResult,
  NeteaseFollowedArtist,
  NeteaseLoginResult,
  NeteaseLyricsResult,
  NeteasePlaylistSummary,
  NeteaseQrResult,
  NeteaseQrSession,
  NeteaseQuality,
  NeteaseSearchResult,
  NeteaseSong,
  NeteaseStatusResult,
  NeteaseStream,
  NeteaseStreamResult
} from './types'

/**
 * The Netease Cloud Music client, wrapped so the rest of Aurora never sees the
 * upstream package.
 *
 * Three things drive the shape of this file.
 *
 * 1. Booting the upstream package is fragile. It reads `%TEMP%\anonymous_token`
 *    with a bare `readFileSync` while its modules load, so the file must exist
 *    before the first `require`, and its own `generateConfig()` asks for an
 *    xeapi key before it has a deviceId to ask with - a circular bootstrap, so
 *    we mint and persist the deviceId ourselves. See `bootstrapOnce`.
 *
 * 2. None of that may stop Aurora from starting. Everything is lazy and every
 *    failure only sets a string: an offline machine opens the player and shows
 *    a "连不上网易云" note on the online tab, it does not crash the app.
 *
 * 3. Upstream responses are as untrusted as a web page. Fields are read through
 *    the narrow helpers below instead of typed as fact, because a single missing
 *    `ar` array would otherwise take down the renderer with a TypeError.
 */

const API_PACKAGE = '@neteasecloudmusicapienhanced/api'

/** How long one upstream call may hang before we call it a network failure. */
const REQUEST_TIMEOUT_MS = 12_000

const TMP = os.tmpdir()
const TOKEN_PATH = path.join(TMP, 'anonymous_token')
const DEVICE_PATH = path.join(TMP, 'aurora_device_id')
const KEY_PATH = path.join(TMP, 'xeapi_public_key')

type Envelope = { status?: number; body?: unknown; cookie?: unknown }
type UpstreamCall = (params: Record<string, unknown>) => Promise<Envelope>

/** Only the endpoints Aurora uses; anything else is not worth exposing. */
interface Upstream {
  cloudsearch: UpstreamCall
  song_url_v1: UpstreamCall
  song_detail: UpstreamCall
  lyric: UpstreamCall
  album: UpstreamCall
  artist_top_song: UpstreamCall
  artist_detail: UpstreamCall
  artist_songs: UpstreamCall
  artist_album: UpstreamCall
  playlist_track_all: UpstreamCall
  recommend_songs: UpstreamCall
  user_cloud: UpstreamCall
  user_playlist: UpstreamCall
  album_sublist: UpstreamCall
  /** 关注的艺人（artist_sublist）：与收藏专辑同一条账号通道。 */
  artist_sublist: UpstreamCall
  top_album: UpstreamCall
  album_newest: UpstreamCall
  likelist: UpstreamCall
  /** 自己建的歌单的五处写：建、加减歌、改名、删单。 */
  playlist_create: UpstreamCall
  playlist_tracks: UpstreamCall
  playlist_name_update: UpstreamCall
  playlist_delete: UpstreamCall
  /** 喜欢/取消喜欢一首歌：写操作，需要真登录。 */
  like: UpstreamCall
  login_qr_key: UpstreamCall
  login_qr_create: UpstreamCall
  login_qr_check: UpstreamCall
  login_cellphone: UpstreamCall
  login_status: UpstreamCall
  user_level: UpstreamCall
  logout: UpstreamCall
  register_anonimous: UpstreamCall
  /**
   * The discover page's three blocks. All three answer without a real login:
   * they are the platform's public front page, not the account's own music.
   */
  personalized_newsong: UpstreamCall
  personalized: UpstreamCall
  top_playlist_highquality: UpstreamCall
  /** 换一批要用的两个公开端点：榜单歌曲、可分页的歌单广场。 */
  playlist_detail: UpstreamCall
  top_playlist: UpstreamCall
  /**
   * 私人漫游：两个都打 `/api/v1/radio/get`。`personal_fm_mode` 带 mode/limit，
   * `personal_fm` 无参（老接口，作为前者空手时的兜底）。
   */
  personal_fm: UpstreamCall
  personal_fm_mode: UpstreamCall
}

let upstream: Upstream | null = null

/**
 * Require the upstream package, creating the token file it demands first.
 *
 * The empty file is not a placeholder for later: the package's own `main.js`
 * writes exactly this, and `util/request.js` reads it at import time. Doing it
 * here as well means the first `require` cannot be the thing that throws, no
 * matter which code path reaches the package first.
 */
function loadUpstream(): Upstream {
  if (upstream) return upstream
  if (!fs.existsSync(TOKEN_PATH)) fs.writeFileSync(TOKEN_PATH, '', 'utf-8')
  upstream = require(API_PACKAGE) as Upstream
  return upstream
}

const apiRoot = (): string => path.dirname(require.resolve(API_PACKAGE))

/** The anonymous cookie from the current run, used until a real login exists. */
let anonymousCookie = ''

/**
 * Which profile's account the next call belongs to.
 *
 * Set by `netease:setProfile` before the renderer asks for anything, because the
 * session lives in the main process while the notion of "who is using the app"
 * lives in the renderer. A module-level value is safe here: the renderer sets it
 * once on switch and then reads sequentially, so calls cannot interleave across
 * two profiles.
 */
let activeProfileId = 'default'

export function setActiveProfile(profileId: string): boolean {
  const next = String(profileId ?? '').trim() || 'default'
  if (next !== activeProfileId) {
    /*
     * Switching profiles must not leave the previous account's answers behind.
     * The account cache is the dangerous one: it holds "who is signed in", and
     * reusing it would attribute one profile's account to another.
     */
    activeProfileId = next
    invalidateAccount()
  }
  return true
}

export function activeProfile(): string {
  return activeProfileId
}

interface BootstrapState {
  ready: boolean
  deviceId: string
  /** Non-secret one-line reason, surfaced by `neteaseStatus`. */
  detail: string
  /** Why the bootstrap failed, so callers can report it honestly. */
  failure: NeteaseFailureReason | null
  keyVersion: string
  hasAnonymousToken: boolean
  /** Whether this run obtained a fresh MUSIC_A, as opposed to reusing one. */
  registered: boolean
}

let bootstrapping: Promise<BootstrapState> | null = null

/**
 * At most one failed handshake per minute - but only for failures that retrying
 * cannot fix.
 *
 * The distinction was learned from a real report: "playback does not work, and I
 * am not even logged in". The bootstrap had failed once with a transient
 * `ECONNRESET`, and because *every* failure was gated behind a 60 s cooldown, the
 * next minute of playback requests returned that stale failure without ever
 * contacting upstream. The same call succeeded seconds later when retried
 * directly, so a single network blip was being presented to the user as a
 * persistent outage.
 *
 * So: a transient failure is retried immediately with a short backoff, while a
 * settled answer (`login-required`, `vip-required`, `region-limited`,
 * `taken-down`) is not retried at all - no amount of repeating turns "you need a
 * membership" into a playable track. The one-minute gate stays for those, and for
 * when the retries are exhausted, so that rerendering the online tab cannot become
 * a request storm.
 *
 * Both policies live in `electron/pure/netease-bootstrap.ts` so they can be tested
 * without the upstream package.
 */
const RETRY_AFTER_MS = HANDSHAKE_COOLDOWN_MS

/** 二维码生成的重试次数与间隔。用户正开着弹窗等，所以比握手策略更短。 */
const QR_ATTEMPTS = 3
const QR_BACKOFF_MS = [500, 1200]

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let failedAt = 0
let lastFailed: BootstrapState = {
  ready: false,
  deviceId: '',
  detail: '',
  failure: null,
  keyVersion: '',
  hasAnonymousToken: false,
  registered: false
}

/**
 * The startup sequence, run once per process while it succeeds, never throwing.
 *
 * Order matters: this is the sequence
 * verified against the live service: empty token file, then our own deviceId,
 * then the xeapi key fetched *with* that deviceId, and only then the anonymous
 * registration. Fetching the key without a deviceId returns a public key with
 * no `sk`, which is what upstream reports later as "xeapi public key is
 * missing" - the circular failure this order exists to avoid.
 *
 * A *successful* bootstrap is cached for the life of the process; a failed one
 * is not. Caching the failure would mean that launching the app before the
 * network is up leaves the online source dead until the next restart, which is
 * a worse outcome than one cheap retry.
 */
async function bootstrapOnce(): Promise<BootstrapState> {
  if (!bootstrapping) {
    if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return lastFailed
    bootstrapping = runBootstrap()
  }

  let state = await bootstrapping

  /*
   * Retry a transient failure in place, before anyone sees it.
   *
   * This is the part that was missing: one blip used to be latched for a minute,
   * so the user's next several play attempts all reported a network problem that
   * had already passed. Retrying here rather than in the caller keeps every
   * entry point (search, stream, lyrics) fixed at once.
   */
  for (let attempt = 0; !state.ready && isTransientHandshakeFailure(state.failure) && attempt < HANDSHAKE_BACKOFF_MS.length; attempt += 1) {
    await sleep(HANDSHAKE_BACKOFF_MS[attempt])
    /*
     * Publish the new attempt on the shared slot before awaiting it, so a parallel
     * caller that arrives during the sleep joins this attempt instead of starting
     * a second one. That is what keeps the retry from becoming a storm.
     */
    bootstrapping = runBootstrap()
    state = await bootstrapping
  }

  if (state.ready) return state
  failedAt = Date.now()
  lastFailed = state
  bootstrapping = null
  return state
}

async function runBootstrap(): Promise<BootstrapState> {
  const state: BootstrapState = {
    ready: false,
    deviceId: '',
    detail: '',
    failure: null,
    keyVersion: '',
    hasAnonymousToken: false,
    registered: false
  }

  try {
    const api = loadUpstream()

    // A deviceId of our own, 52 hex characters, persisted so the xeapi key that
    // is bound to it stays valid across restarts.
    const deviceId = readOrCreateDeviceId()
    state.deviceId = deviceId
    ;(globalThis as unknown as { deviceId?: string }).deviceId = deviceId

    // The key service only answers with `sk` when the request carries a
    // deviceId, so this call is the whole point of minting one first.
    const { getXeapiPublicKey } = require(path.join(apiRoot(), 'util', 'xeapiKey.js')) as {
      getXeapiPublicKey: (
        current: Record<string, unknown>,
        deviceId: string
      ) => Promise<Record<string, unknown>>
    }
    const key = await getXeapiPublicKey(readJson(KEY_PATH), deviceId)
    fs.writeFileSync(KEY_PATH, JSON.stringify(key), 'utf-8')
    state.keyVersion = asString(key.version)

    // Anonymous registration last: it is itself xeapi-signed, so it only works
    // now that the key above exists. A token from an earlier run is reused
    // rather than replaced, because request.js caches the file at import time
    // and re-registering would leave the two out of step for no benefit.
    const existingToken = readText(TOKEN_PATH)
    if (existingToken) {
      state.hasAnonymousToken = true
    } else {
      const anon = await api.register_anonimous({ deviceId })
      const body = asRecord(anon.body)
      const cookie = asString(body.cookie)
      const token = /MUSIC_A=([^;]+)/.exec(cookie)?.[1] ?? ''
      if (token) {
        fs.writeFileSync(TOKEN_PATH, token, 'utf-8')
        state.hasAnonymousToken = true
        state.registered = true
      } else {
        // Upstream throttles repeated anonymous registrations and answers 400
        // with no cookie when it does. That is not fatal: `song_url_v1` is
        // signed with the xeapi key above, which is why anonymous playback
        // still works with an empty token file.
        console.error(
          '[aurora] netease anonymous registration returned no token, code',
          asNumber(body.code)
        )
      }
      // Keep the anonymous cookie in memory too: request.js captured the empty
      // token file when it loaded, so the file alone would not reach this
      // process's requests.
      if (cookie) anonymousCookie = cookie
    }

    state.ready = true
  } catch (error) {
    state.detail = readable(error)
    state.failure = classifyStreamFailure({ error })
    console.error('[aurora] netease bootstrap failed', state.detail)
  }

  return state
}

function readOrCreateDeviceId(): string {
  const existing = readText(DEVICE_PATH).trim()
  if (/^[0-9a-fA-F]{52}$/.test(existing)) return existing
  // crypto.randomBytes gives the 52 hex characters the key service expects and
  // does not depend on the upstream package's own generator being reachable.
  const created = crypto.randomBytes(26).toString('hex')
  fs.writeFileSync(DEVICE_PATH, created, 'utf-8')
  return created
}

const readText = (file: string): string => {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return ''
  }
}

const readJson = (file: string): Record<string, unknown> => {
  try {
    return asRecord(JSON.parse(readText(file)))
  } catch {
    return {}
  }
}

/** The cookie to send, or '' when only the anonymous token applies. */
function cookieForCall(): string {
  return readCookie(activeProfileId) || anonymousCookie
}

/**
 * One upstream call, with the session cookie and a hard timeout attached.
 *
 * The timeout is not optional: without it a request to a blackholed host sits
 * on the UI thread's promise for as long as the OS lets it, and the user sees a
 * spinner instead of an error.
 */
async function call(name: keyof Upstream, params: Record<string, unknown>): Promise<Envelope> {
  const api = loadUpstream()
  const fn = api[name]
  if (typeof fn !== 'function') throw new Error(`netease: upstream is missing ${name}`)

  const payload: Record<string, unknown> = { ...params, timeout: REQUEST_TIMEOUT_MS }
  const cookie = cookieForCall()
  if (cookie) payload.cookie = cookie
  return await fn(payload)
}

// --- untrusted-response readers -------------------------------------------

type Json = Record<string, unknown>

function asRecord(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const asNullableString = (value: unknown): string | null => asString(value) || null

/** `body.data` when upstream wraps its payload, otherwise `body` itself. */
function payloadOf(body: unknown): Json {
  const record = asRecord(body)
  const data = record.data
  return data && typeof data === 'object' && !Array.isArray(data) ? asRecord(data) : record
}

function readable(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

// --- normalisation --------------------------------------------------------

/**
 * Upstream spells the same song three ways depending on the endpoint
 * (`ar`/`al` on search and detail, `artists`/`album` on older routes, and
 * `simpleSong` on cloud files), so everything funnels through one mapper.
 */
function toSong(value: unknown): NeteaseSong | null {
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

function toSongs(value: unknown): NeteaseSong[] {
  return asArray(value)
    .map(toSong)
    .filter((song): song is NeteaseSong => song !== null)
}

const joinArtists = (value: unknown): string =>
  asArray(value)
    .map((entry) => asString(asRecord(entry).name))
    .filter(Boolean)
    .join(' / ')

const yearOf = (publishTime: unknown): number | null => {
  const ms = asNumber(publishTime)
  if (ms <= 0) return null
  const year = new Date(ms).getFullYear()
  return Number.isFinite(year) ? year : null
}

const clamp = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min

// --- status --------------------------------------------------------------

/**
 * 只做设备握手，不碰账号。
 *
 * 开屏期提前跑：`bootstrapOnce` 要铸 deviceId、取密钥、换令牌，几百毫秒到一秒多；
 * 等用户点开漫游才做，这段时间就落在操作上了。单例，重复调用直接命中缓存。
 */
export async function neteaseWarmUp(): Promise<void> {
  await bootstrapOnce()
}

export async function neteaseStatus(): Promise<NeteaseStatusResult> {
  const state = await bootstrapOnce()
  if (!state.ready) return { ready: false, loggedIn: false, detail: state.detail }
  const account = await safeAccount()
  return { ready: true, loggedIn: account !== null, detail: state.detail || undefined }
}


// --- search and metadata -------------------------------------------------

export async function neteaseSearch(
  keywords: string,
  type: 'song' | 'album' | 'artist',
  limit = 30
): Promise<NeteaseSearchResult> {
  const API_TYPE = { song: 1, album: 10, artist: 100 } as const
  const res = await call('cloudsearch', {
    keywords,
    type: API_TYPE[type],
    limit: clamp(limit, 1, 100)
  })

  const result = asRecord(asRecord(res.body).result)
  const songs = toSongs(result.songs)

  const albums = asArray(result.albums).map((entry) => {
    const raw = asRecord(entry)
    return {
      id: asNumber(raw.id),
      name: asString(raw.name),
      artist: joinArtists(raw.artists) || asString(asRecord(raw.artist).name),
      picUrl: asNullableString(raw.picUrl),
      year: yearOf(raw.publishTime),
      songCount: asNumber(raw.size)
    }
  })

  const artists = asArray(result.artists).map((entry) => {
    const raw = asRecord(entry)
    return {
      id: asNumber(raw.id),
      name: asString(raw.name),
      picUrl: asNullableString(raw.picUrl),
      albumCount: asNumber(raw.albumSize)
    }
  })

  return { songs, albums, artists }
}

export async function neteaseSongDetail(ids: number[]): Promise<NeteaseSong[]> {
  const unique = Array.from(new Set(ids)).slice(0, 1000)
  if (unique.length === 0) return []
  // song_detail splits this string itself, so it must be a comma-separated
  // string rather than an array.
  const res = await call('song_detail', { ids: unique.join(',') })
  return toSongs(asRecord(res.body).songs)
}

export async function neteaseAlbum(id: number): Promise<NeteaseAlbum | null> {
  if (!isUsableId(id)) return null
  const res = await call('album', { id })
  const body = asRecord(res.body)
  const raw = asRecord(body.album)
  const albumId = asNumber(raw.id)
  if (!albumId) return null

  return {
    id: albumId,
    name: asString(raw.name),
    artist: joinArtists(raw.artists) || asString(asRecord(raw.artist).name),
    artistId: asNumber(asRecord(asArray(raw.artists)[0]).id) || null,
    coverUrl: asNullableString(raw.picUrl),
    year: yearOf(raw.publishTime),
    description: asString(raw.description) || asString(raw.briefDesc),
    songs: toSongs(body.songs)
  }
}

export async function neteaseArtistTopSongs(id: number, limit = 50): Promise<NeteaseSong[]> {
  if (!isUsableId(id)) return []
  const res = await call('artist_top_song', { id })
  return toSongs(asRecord(res.body).songs).slice(0, clamp(limit, 1, 50))
}

/**
 * 艺人的自我介绍与规模。
 *
 * `artist_detail` 在几个版本里换过外形：老版本把艺人放在 `artist`，新版本塞进
 * `data.artist`。两个都认，认不到就返回 null，让页面说「没取到」，而不是画一个空壳。
 */
export async function neteaseArtistDetail(id: number): Promise<NeteaseArtistDetail | null> {
  if (!isUsableId(id)) return null
  const res = await call('artist_detail', { id })
  const body = asRecord(res.body)
  const nested = asRecord(asRecord(body.data).artist)
  const raw = asNumber(nested.id) ? nested : asRecord(body.artist)
  const artistId = asNumber(raw.id)
  if (!artistId) return null
  return {
    id: artistId,
    name: asString(raw.name),
    // artist_detail 的头像在 `cover`（新版）或 `avatar`（老版），不在 picUrl 上。
    coverUrl:
      asNullableString(raw.picUrl) ??
      asNullableString(raw.cover) ??
      asNullableString(raw.avatar) ??
      asNullableString(raw.img1v1Url),
    briefDesc: asString(raw.briefDesc),
    albumCount: asNumber(raw.albumSize),
    songCount: asNumber(raw.musicSize)
  }
}

/** 艺人全部歌曲（按热度排），不是热门那 50 首。 */
export async function neteaseArtistSongs(id: number, limit = 200, offset = 0): Promise<NeteaseSong[]> {
  if (!isUsableId(id)) return []
  const res = await call('artist_songs', {
    id,
    limit: clamp(limit, 1, 500),
    offset: Math.max(0, offset),
    order: 'hot'
  })
  return toSongs(asRecord(res.body).songs)
}

/** 艺人的专辑墙。 */
export async function neteaseArtistAlbums(
  id: number,
  limit = 60,
  offset = 0
): Promise<NeteaseAlbumSummary[]> {
  if (!isUsableId(id)) return []
  const res = await call('artist_album', { id, limit: clamp(limit, 1, 100), offset: Math.max(0, offset) })
  const body = asRecord(res.body)
  const rows = asArray(body.hotAlbums).length > 0 ? asArray(body.hotAlbums) : asArray(body.albums)
  return rows
    .map((entry) => {
      const raw = asRecord(entry)
      const albumId = asNumber(raw.id)
      if (!albumId) return null
      return {
        id: albumId,
        name: asString(raw.name),
        coverUrl: asNullableString(raw.picUrl),
        year: yearOf(raw.publishTime),
        songCount: asNumber(raw.size)
      }
    })
    .filter((entry): entry is NeteaseAlbumSummary => entry !== null)
}

export async function neteaseLyrics(songId: number): Promise<NeteaseLyricsResult | null> {
  if (!isUsableId(songId)) return null
  const res = await call('lyric', { id: songId })
  const body = asRecord(res.body)
  const lrc = asNullableString(asRecord(body.lrc).lyric)
  const translation = asNullableString(asRecord(body.tlyric).lyric)
  // Instrumentals are a real answer, not an error: no lyric at all is `null`,
  // and a lyric with no translation is a lyric.
  if (!lrc && !translation) return null
  return { lrc, translation }
}

// --- playable stream -----------------------------------------------------

const QUALITY_LEVELS = new Set(['standard', 'higher', 'exhigh', 'lossless', 'hires'])

function levelOf(value: unknown, requested: NeteaseQuality): NeteaseQuality | 'hires' {
  const level = asString(value)
  if (QUALITY_LEVELS.has(level)) return level as NeteaseQuality | 'hires'
  return requested
}

/**
 * Resolve a playable URL, classifying every refusal instead of collapsing it.
 *
 * `song_url_v1` reports "no" through a per-track `url: null` and sometimes an
 * empty `fee`, so when there is nothing playable the fee is looked up
 * separately - that one field is what separates "buy a membership" from "this
 * track is gone", and guessing between them is exactly what the contract
 * forbids.
 */
export async function neteaseStreamUrl(
  songId: number,
  quality: NeteaseQuality = 'exhigh'
): Promise<NeteaseStreamResult> {
  if (!isUsableId(songId)) {
    return { ok: false, reason: 'unknown', message: '歌曲 ID 无效' }
  }
  try {
    const state = await bootstrapOnce()
    // A failed bootstrap is not the track's fault, and `song_url_v1` would only
    // report it as a confusing upstream error. Say what actually went wrong.
    if (!state.ready) {
      const reason = state.failure ?? 'service-unavailable'
      return { ok: false, reason, message: state.detail || describeFailure(reason) }
    }

    const res = await call('song_url_v1', { id: songId, level: quality })
    const body = asRecord(res.body)
    const entry = asRecord(asArray(body.data)[0])

    const url = asString(entry.url)
    const trialInfo = asRecord(entry.freeTrialInfo)
    const trial = Object.keys(trialInfo).length > 0

    if (url) {
      const from = trial ? asNumber(trialInfo.start) : 0
      const to = trial ? asNumber(trialInfo.end) : 0
      const served = Math.round(asNumber(entry.time) / 1000)
      const stream: NeteaseStream = {
        url,
        br: asNumber(entry.br),
        level: levelOf(entry.level, quality),
        // `time` is the length of the file this URL actually serves, which is
        // the only honest duration for a trial fragment.
        duration: served > 0 ? served : to > from ? to - from : 0,
        trial
      }
      if (trial) {
        stream.trialFrom = from
        stream.trialTo = to
      }
      return { ok: true, stream }
    }

    const loggedIn = readCookie(activeProfileId).length > 0
    const fee = typeof entry.fee === 'number' ? entry.fee : await feeOf(songId)
    const reason = classifyStreamFailure({
      code: asNumber(body.code),
      songCode: typeof entry.code === 'number' ? entry.code : null,
      url: null,
      freeTrialInfo: entry.freeTrialInfo,
      fee,
      loggedIn
    })
    return { ok: false, reason, message: describeFailure(reason) }
  } catch (error) {
    const reason = classifyStreamFailure({ error })
    // Never log the URL or the cookie, only the shape of the failure.
    console.error('[aurora] netease stream lookup failed', reason, readable(error))
    return { ok: false, reason, message: describeFailure(reason) }
  }
}

/** The `fee` of one song, or 0 when even that lookup fails. */
async function feeOf(songId: number): Promise<number> {
  try {
    const songs = await neteaseSongDetail([songId])
    return songs[0]?.fee ?? 0
  } catch {
    return 0
  }
}

// --- login ---------------------------------------------------------------

export async function neteaseQrCreate(): Promise<NeteaseQrSession> {
  await bootstrapOnce()

  // 这个调用会间歇失败（实测 login_qr_key 回 502 ECONNRESET，稍后即成功），所以重试。
  const attempt = async (): Promise<{ key: string; url: string; imageDataUrl: string }> => {
    const keyRes = await call('login_qr_key', {})
    const key = asString(asRecord(payloadOf(keyRes.body)).unikey)
    if (!key) throw new Error('netease: no qr key')

    // `qrimg` is what makes the package render the PNG data URL for us; without
    // it the response carries only the URL and the renderer would need a QR
    // encoder of its own.
    const created = await call('login_qr_create', { key, qrimg: true })
    const data = asRecord(payloadOf(created.body))
    const imageDataUrl = asString(data.qrimg)
    // 空图片就是失败：界面拿到空字符串就是一个空白框。
    if (!imageDataUrl) throw new Error('netease: qr image missing')
    return {
      key,
      url: asString(data.qrurl) || `https://music.163.com/login?codekey=${key}`,
      imageDataUrl
    }
  }

  let lastError: unknown = null
  for (let i = 0; i < QR_ATTEMPTS; i += 1) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
      // Only transport failures are worth repeating; a rejected key is not.
      if (!isTransientHandshakeFailure(classifyStreamFailure({ error }))) throw error
      if (i < QR_ATTEMPTS - 1) await sleep(QR_BACKOFF_MS[i] ?? 800)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('netease: qr create failed')
}

export async function neteaseQrCheck(key: string): Promise<NeteaseQrResult> {
  const res = await call('login_qr_check', { key })
  const body = asRecord(res.body)
  const code = asNumber(body.code)

  if (code === 800) return { status: 'expired', message: '二维码已过期，请重新获取' }
  if (code === 801) return { status: 'waiting' }
  if (code === 802) return { status: 'scanned', message: '已扫码，请在手机上确认' }
  if (code === 803) {
    const cookie = asString(body.cookie)
    if (cookie) writeCookie(activeProfileId, cookie)
    invalidateAccount()
    return { status: 'confirmed', account: (await safeAccount()) ?? undefined }
  }
  return { status: 'failed', message: asString(body.message) || '登录失败，请重试' }
}

export async function neteaseLoginCellphone(
  phone: string,
  password: string
): Promise<NeteaseLoginResult> {
  await bootstrapOnce()
  // The password is handed to upstream, which hashes it, and is never logged,
  // stored or put into an error message. Errors below go out by code only.
  const res = await call('login_cellphone', { phone, password })
  const body = asRecord(res.body)
  const code = asNumber(body.code)

  if (code !== 200) return { ok: false, message: loginMessage(code) }

  const cookie = asString(body.cookie)
  if (cookie) writeCookie(activeProfileId, cookie)
  invalidateAccount()
  return { ok: true, account: (await safeAccount()) ?? undefined }
}

/** Upstream's login codes, in the wording the user needs rather than the number. */
function loginMessage(code: number): string {
  switch (code) {
    case 400:
      return '手机号或密码不正确'
    case 501:
      return '该手机号尚未注册网易云'
    case 502:
      return '密码错误'
    case 503:
      return '请求过于频繁，请稍后再试'
    case 504:
      return '该账号存在安全风险，请先在网易云客户端完成验证'
    case 509:
      return '该账号已被限制登录，请稍后再试'
    case 250:
      return '需要先完成人机验证，请改用二维码登录'
    default:
      return '登录失败，请重试'
  }
}

export async function neteaseLoginStatus(): Promise<NeteaseAccount | null> {
  await bootstrapOnce()
  return await safeAccount()
}

export async function neteaseLogout(): Promise<boolean> {
  try {
    await call('logout', {})
  } catch (error) {
    // The account is signed out locally either way; a failed upstream call
    // only means the server keeps a session nobody here can use.
    console.error('[aurora] netease logout did not reach upstream', readable(error))
  }
  clearCookie(activeProfileId)
  invalidateAccount()
  anonymousCookie = ''
  return true
}

/**
 * Sign a *specific* profile out, without disturbing the active one.
 *
 * The profiles screen has to be able to unbind an account from a profile that is
 * not the one currently in use, so this reads the session by id rather than
 * through the module-level pointer.
 */
export function neteaseLogoutProfile(profileId: string): boolean {
  clearCookie(profileId)
  if (profileId === activeProfileId) {
    invalidateAccount()
    anonymousCookie = ''
  }
  return true
}

/** Whether a profile has a session at all; no upstream call. */
export function profileHasSession(profileId: string): boolean {
  return hasCookie(profileId)
}

/**
 * The account a *specific* profile is signed in as, for the profiles screen.
 *
 * Reads that profile's session, so it works whether or not that profile is the
 * active one. `invalidateAccount` runs on both edges of the switch, so the
 * shared cache cannot answer with the wrong profile's identity.
 */
export async function neteaseAccountFor(profileId: string): Promise<NeteaseAccount | null> {
  const previous = activeProfileId
  try {
    setActiveProfile(profileId)
    if (!readCookie(activeProfileId)) return null
    await bootstrapOnce()
    return await safeAccount()
  } catch (error) {
    console.error('[aurora] could not read the account of another profile', readable(error))
    return null
  } finally {
    setActiveProfile(previous)
  }
}

/**
 * Who is signed in, cached briefly.
 *
 * Opening the "my music" page asks for playlists, the daily list, cloud files
 * and likes in one go, and every one of them needs the uid first. Without this
 * that is four extra round trips that all return the same answer.
 */
let accountCache: { value: NeteaseAccount | null; at: number } | null = null
const ACCOUNT_TTL_MS = 30_000

function invalidateAccount(): void {
  accountCache = null
}

async function safeAccount(): Promise<NeteaseAccount | null> {
  if (accountCache && Date.now() - accountCache.at < ACCOUNT_TTL_MS) return accountCache.value

  let value: NeteaseAccount | null = null
  try {
    const res = await call('login_status', {})
    const body = asRecord(res.body)
    const payload = payloadOf(body)
    const profile = asRecord(payload.profile)
    const userId = asNumber(profile.userId)
    if (userId) {
      value = {
        userId,
        nickname: asString(profile.nickname) || '网易云用户',
        avatarUrl: asNullableString(profile.avatarUrl),
        vip: asNumber(profile.vipType) > 0,
        level: await levelOfUser()
      }
    }
  } catch {
    // Signed out, offline or an expired cookie all look the same from here.
  }

  accountCache = { value, at: Date.now() }
  return value
}

async function levelOfUser(): Promise<number> {
  try {
    const res = await call('user_level', {})
    // `body.data.level` on the v1 route, `body.level` on the fallback.
    return asNumber(payloadOf(asRecord(res.body)).level)
  } catch {
    return 0
  }
}

// --- personal music ------------------------------------------------------

/**
 * Personal music answers with empty lists rather than errors when signed out:
 * the online tab must look empty, not broken, and a thrown rejection would
 * surface as an unhandled failure in the page.
 */
export async function neteaseMyPlaylists(): Promise<NeteasePlaylistSummary[]> {
  await bootstrapOnce()
  const account = await safeAccount()
  if (!account) return []

  const res = await call('user_playlist', { uid: account.userId, limit: 1000, offset: 0 })
  return asArray(asRecord(res.body).playlist)
    .map((entry) => {
      const raw = asRecord(entry)
      return {
        id: asNumber(raw.id),
        name: asString(raw.name),
        coverUrl: asNullableString(raw.coverImgUrl),
        trackCount: asNumber(raw.trackCount),
        playCount: asNumber(raw.playCount),
        creator: asString(asRecord(raw.creator).nickname),
        subscribed: Boolean(raw.subscribed)
      }
    })
    .filter((playlist) => playlist.id > 0)
}

export async function neteasePlaylistTracks(id: number): Promise<NeteaseSong[]> {
  if (!isUsableId(id)) return []
  const res = await call('playlist_track_all', { id })
  return toSongs(asRecord(res.body).songs)
}

/**
 * 一张歌单是谁建的。
 *
 * 首页推荐位上的卡片来自公开推荐接口，那一路只给名字和封面、不带创建者；详情页
 * 于是只能显示「—」。打开这种卡片时补问一次歌单详情，就是为这一个字段。
 */
export async function neteasePlaylistCreator(id: number): Promise<string> {
  if (!isUsableId(id)) return ''
  const res = await call('playlist_detail', { id })
  return asString(asRecord(asRecord(asRecord(res.body).playlist).creator).nickname)
}

export async function neteaseDailySongs(): Promise<NeteaseSong[]> {
  await bootstrapOnce()
  if (!(await safeAccount())) return []
  const res = await call('recommend_songs', {})
  // The v3 route nests the list, the older one does not.
  const body = asRecord(res.body)
  const data = asRecord(body.data)
  return toSongs(asArray(data.dailySongs).length > 0 ? data.dailySongs : body.recommend)
}

/**
 * 私人漫游。
 *
 * 网易云的「漫游」不是把曲库打乱，而是一条源源不断的推荐流：每次只给几首没听过的，
 * 听完再要下一批。所以这里不缓存、不合并——调用方拉到几首就追加几首，重复由调用方
 * 按 id 去重。未登录时上游只会给空数组，漫游页据此退回到「洗自己的库」。
 *
 * `personal_fm_mode` 能带 limit（默认 3）；它偶尔会因为 mode 参数被上游拒，兜底回到
 * 无参的 `personal_fm`——两条路由打的是同一个 `/api/v1/radio/get`。
 */
export async function neteasePersonalFm(limit = 3): Promise<NeteaseSong[]> {
  await bootstrapOnce()
  if (!(await safeAccount())) return []
  const want = Math.min(Math.max(Math.trunc(limit) || 3, 1), 20)
  const first = await call('personal_fm_mode', { limit: want }).catch(() => null)
  const rows = first ? asArray(asRecord(first.body).data) : []
  if (rows.length > 0) return toSongs(rows)
  const fallback = await call('personal_fm', {}).catch(() => null)
  return fallback ? toSongs(asArray(asRecord(fallback.body).data)) : []
}

// --- discover ------------------------------------------------------------

/**
 * The three blocks the discover page asks for, all from the public front page.
 *
 * Measured against the live service: all three answer `code: 200` without a
 * real login, which is the point - the page has to be worth opening before the
 * user has signed in anywhere. They do need the bootstrap below, though: the
 * request signing key is minted there, and without it the package's own request
 * layer fails before it reaches upstream.
 *
 * 24 是一条卡片墙够用的量：12 条在宽窗口里只铺满一行半，剩下半行是空白，
 * 看起来像没加载完。上限放到 60：首页「最近新歌」要凑满四十条，早先卡在 30，
 * 页面只能显示二十四首。这个上限也挡住旧渲染层要更大的页。
 */
const DISCOVER_DEFAULT_LIMIT = 24
const DISCOVER_MAX_LIMIT = 60

/**
 * A row from either route, keyed by the list's own name.
 *
 * `payloadOf` is tried first because some v1 routes nest the list one level
 * deeper, but the older routes put it directly on the body - and the front page
 * is exactly the mix of both that makes guessing wrong.
 */
function discoverRows(body: unknown, keys: readonly string[]): unknown[] {
  const payload = payloadOf(body)
  const root = asRecord(body)
  // 同一批端点在不同版本里把列表放在 result / playlists / recommend 下，按顺序找第一个非空的。
  for (const key of keys) {
    const nested = asArray(payload[key])
    if (nested.length > 0) return nested
    const direct = asArray(root[key])
    if (direct.length > 0) return direct
  }
  return []
}

/**
 * `personalized_newsong` wraps each song in a recommendation object
 * (`{ id, name, picUrl, song }`), and the nested song uses the old spellings
 * (`artists`/`album`) with a millisecond `duration` and no `dt`. `toSong`
 * reads neither, so this reads both shapes and normalises to the one contract
 * the renderer knows.
 */
function toDiscoverSong(value: unknown): NeteaseSong | null {
  const wrapper = asRecord(value)
  const nested = asRecord(wrapper.song)
  const raw = Object.keys(nested).length > 0 ? nested : wrapper

  const id = asNumber(raw.id) || asNumber(wrapper.id)
  if (!id) return null

  const artistSource = asArray(raw.ar).length > 0 ? asArray(raw.ar) : asArray(raw.artists)
  const artists: NeteaseArtist[] = artistSource
    .map((entry) => ({ id: asNumber(asRecord(entry).id), name: asString(asRecord(entry).name) }))
    .filter((artist) => artist.name.length > 0)

  const albumSource = asRecord(raw.al ?? raw.album)
  const durationMs = asNumber(raw.dt) || asNumber(raw.duration)

  return {
    id,
    name: asString(raw.name) || asString(wrapper.name) || '未知歌曲',
    artists,
    album: {
      id: asNumber(albumSource.id),
      name: asString(albumSource.name),
      picUrl: asNullableString(albumSource.picUrl) ?? asNullableString(wrapper.picUrl)
    },
    // Both shapes report milliseconds; the bridge contract is seconds.
    duration: Math.round(durationMs / 1000),
    fee: asNumber(raw.fee)
  }
}

function toDiscoverPlaylist(value: unknown): NeteaseDiscoverPlaylist | null {
  const raw = asRecord(value)
  const id = asNumber(raw.id)
  if (!id) return null

  return {
    id,
    name: asString(raw.name) || '未命名歌单',
    // `personalized` spells the cover `picUrl`, the editor route `coverImgUrl`.
    coverUrl: asNullableString(raw.coverImgUrl) ?? asNullableString(raw.picUrl),
    trackCount: asNumber(raw.trackCount),
    playCount: asNumber(raw.playCount),
    creator: asString(asRecord(raw.creator).nickname),
    note: asString(raw.copywriter)
  }
}

/**
 * 换一批时轮换的公开榜单。
 *
 * 「推荐新歌」一个人一天只有一份：同一个账号连续请求两次，拿到的是同一个列表
 * （实测顺序都一致）。用户点两下「换一批」看到一模一样的歌，只会以为按钮坏了。
 * 所以第一批用真实推荐，之后按顺序换到热歌榜 / 说唱榜 / 飙升榜 / 原创榜，再往后
 * 在每个榜内部翻页。这四个榜都是公开接口，不需要登录。
 *
 * 新歌榜（3779629）故意不在这里：实测它前 24 首与 `personalized_newsong` 的
 * 30 首重叠 24/24，等于没换。下面四个榜与推荐的重叠依次是 3 / 3 / 11 / 9 首。
 */
const DISCOVER_TOPLISTS = [3778678, 2809513713, 19723756, 2884035] as const

/**
 * 分类歌单按风格轮换。
 *
 * `top_playlist_highquality` 没有 offset，翻不动；`top_playlist` 有分类和
 * 分页，所以「分类歌单」改成按风格走：同一次会话里点「换一批」会依次看到全部、
 * 华语、欧美……而不是永远同一批。
 */
const DISCOVER_GENRES = ['全部', '华语', '欧美', '电子', '民谣', '摇滚', '古风', '轻音乐'] as const

/**
 * One block of the discover page, for anonymous visitors as well as accounts.
 *
 * `offset` is "how many rows have already been shown for this block", so the
 * renderer can ask for the next batch without the main process keeping any state.
 *
 * Never throws for a normal upstream failure: the caller replaces a rejected
 * `invoke` with nothing at all, so a network error would reach the page as an
 * unhandled rejection in the middle of a render. The IPC layer turns this into
 * an empty block plus a retry button instead.
 */
export async function neteaseDiscover(
  kind: NeteaseDiscoverKind,
  limit?: number,
  offset?: number
): Promise<NeteaseDiscoverResult> {
  const size = clamp(asNumber(limit) || DISCOVER_DEFAULT_LIMIT, 1, DISCOVER_MAX_LIMIT)
  const start = Math.max(0, Math.trunc(asNumber(offset)))
  const batch = Math.floor(start / size)
  await bootstrapOnce()

  if (kind === 'newsongs') {
    if (batch === 0) {
      const res = await call('personalized_newsong', { limit: DISCOVER_MAX_LIMIT })
      const songs = discoverRows(res.body, ['result'])
        .map(toDiscoverSong)
        .filter((song): song is NeteaseSong => song !== null)
        .slice(0, size)
      return { kind, songs, playlists: [] }
    }

    const listIndex = (batch - 1) % DISCOVER_TOPLISTS.length
    const round = Math.floor((batch - 1) / DISCOVER_TOPLISTS.length)

    /*
     * 一张榜单取回空是常有的事：上游按 id 做缓存，抖一次就整个 track 列表都不给。
     * 早先这里直接返回空，前端「换一批」就变成「整块消失」。现在按顺序试下一张，
     * 四张都空才算这次真的没有。
     */
    for (let attempt = 0; attempt < DISCOVER_TOPLISTS.length; attempt += 1) {
      const id = DISCOVER_TOPLISTS[(listIndex + attempt) % DISCOVER_TOPLISTS.length]
      const res = await call('playlist_detail', { id })
      const tracks = asArray(asRecord(asRecord(res.body).playlist).tracks)
      const songs = tracks
        .map(toSong)
        .filter((song): song is NeteaseSong => song !== null)
      if (songs.length === 0) continue

      // 榜单长度不固定（100 / 200 首都有），翻到底就绕回开头：按钮永远有东西可给，
      // 不会变成一次空列表让页面闪一下空态。
      const start = (round * size) % songs.length
      const window = songs.slice(start, start + size)
      const wrapped =
        window.length === size ? window : window.concat(songs.slice(0, size - window.length))
      return { kind, songs: wrapped, playlists: [] }
    }
    return { kind, songs: [], playlists: [] }
  }

  /*
   * 两个歌单栏目走两条不同的路，页面上的区别才对得上栏目名：
   *
   * - 推荐歌单：第一批是平台给这个人的推荐（未登录时是公开的编辑推荐），之后
   *   换到歌单广场按热度分页。两者实测只重叠 1/24，点一次就是另一批。
   * - 分类歌单：走 `top_playlist_highquality`，这是平台按风格人工甄选的那一栏，
   *   每换一次换一个风格（全部 → 华语 → 欧美 …）。同一个风格里不翻页：那个接口
   *   的分页游标是上一页最后一条的更新时间，拿不到就只能重来，8 个风格够点 8 次。
   */
  if (kind === 'playlists' && batch === 0) {
    const res = await call('personalized', { limit: DISCOVER_MAX_LIMIT })
    const playlists = discoverRows(res.body, ['result', 'playlists'])
      .map(toDiscoverPlaylist)
      .filter((playlist): playlist is NeteaseDiscoverPlaylist => playlist !== null)
      .slice(0, size)
    return { kind, songs: [], playlists }
  }

  if (kind === 'quality') {
    const res = await call('top_playlist_highquality', {
      cat: DISCOVER_GENRES[batch % DISCOVER_GENRES.length],
      limit: size,
      // 0 表示从头取这一风格里最新的那批。
      before: 0
    })
    const playlists = discoverRows(res.body, ['playlists', 'result'])
      .map(toDiscoverPlaylist)
      .filter((playlist): playlist is NeteaseDiscoverPlaylist => playlist !== null)
      .slice(0, size)
    return { kind, songs: [], playlists }
  }

  const res = await call('top_playlist', {
    cat: '全部',
    order: 'hot',
    limit: size,
    offset: (batch - 1) * size
  })
  const playlists = discoverRows(res.body, ['playlists', 'result'])
    .map(toDiscoverPlaylist)
    .filter((playlist): playlist is NeteaseDiscoverPlaylist => playlist !== null)
    .slice(0, size)
  return { kind, songs: [], playlists }
}

export async function neteaseCloudSongs(): Promise<NeteaseSong[]> {
  await bootstrapOnce()
  if (!(await safeAccount())) return []

  // Paged, because the cloud list has no upper bound and a single 100k request
  // would hang the tab. 200 a page up to 1000 covers real libraries.
  const songs: NeteaseSong[] = []
  const pageSize = 200
  for (let offset = 0; offset < 1000; offset += pageSize) {
    const res = await call('user_cloud', { limit: pageSize, offset })
    const page = asArray(asRecord(res.body).data)
    const mapped = page
      .map((entry) => {
        const raw = asRecord(entry)
        // Cloud entries carry the song either nested or as loose fields.
        const nested = toSong(raw.simpleSong ?? raw.song)
        if (nested) return nested
        const id = asNumber(raw.songId)
        if (!id) return null
        return {
          id,
          name: asString(raw.songName) || '未知歌曲',
          artists: asArray(raw.artist)
            .map((name) => ({ id: 0, name: asString(name) }))
            .filter((artist) => artist.name),
          album: { id: 0, name: asString(raw.album) || '', picUrl: null },
          duration: Math.round(asNumber(raw.duration) / 1000),
          fee: 0
        } satisfies NeteaseSong
      })
      .filter((song): song is NeteaseSong => song !== null)
    songs.push(...mapped)
    if (page.length < pageSize) break
  }
  return songs
}

export async function neteaseLikeList(): Promise<NeteaseSong[]> {
  await bootstrapOnce()
  const account = await safeAccount()
  if (!account) return []

  const res = await call('likelist', { uid: account.userId })
  const ids = asArray(asRecord(res.body).ids)
    .map(asNumber)
    .filter((id) => id > 0)
  if (ids.length === 0) return []

  // song_detail caps a single request at 1000 ids; chunk so a large like list
  // cannot silently come back truncated.
  const songs: NeteaseSong[] = []
  for (let index = 0; index < ids.length; index += 500) {
    songs.push(...(await neteaseSongDetail(ids.slice(index, index + 500))))
  }
  return songs
}

/**
 * 喜欢或取消喜欢一首歌。
 *
 * 这是写操作，和读接口不一样：匿名 cookie 会被上游拒绝，所以先确认登录，
 * 未登录返回 false 让页面去提示登录，而不是发一个注定失败的请求。上游只回
 * `code === 200`，没有别的字段能判真伪，就直接把这一条当结果。
 */
export async function neteaseLike(songId: number, liked: boolean): Promise<boolean> {
  if (!Number.isSafeInteger(songId) || songId <= 0) return false
  await bootstrapOnce()
  if (!(await safeAccount())) return false

  const res = await call('like', { id: songId, like: liked ? 'true' : 'false' })
  return asNumber(asRecord(res.body).code) === 200
}

/*
 * 自己建的歌单：建、加歌、删歌、改名、删单。
 *
 * 这几条和「喜欢」一样是写操作，未登录一律回 false/null——匿名 cookie 会被上游
 * 拒绝，发出去只是让用户等一次注定失败的网络。判真伪只看 `code === 200`，上游
 * 没有更细的结果字段。
 *
 * `playlist_tracks` 的 `tracks` 要逗号串而不是数组：模块内部自己 `split(',')`，
 * 传数组会拼成 ""1,2"" 那种上游读不懂的东西。
 */
async function writeOk(name: keyof Upstream, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  await bootstrapOnce()
  if (!(await safeAccount())) return null
  const res = await call(name, params)
  const body = asRecord(res.body)
  /*
   * 两种回包都见过：playlist_create 这类把 code 写在外面，playlist_tracks
   * 这类包一层 { status, body: { code } }。只读外面会把「歌其实已经进单了」
   * 误判成失败，所以两处都读。
   */
  const inner = asRecord(body.body)
  if (asNumber(body.code) !== 200 && asNumber(inner.code) !== 200) return null
  return asNumber(body.code) === 200 ? body : inner
}

export async function neteasePlaylistCreate(name: string): Promise<{ id: number; name: string } | null> {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return null
  const body = await writeOk('playlist_create', { name: trimmed })
  if (!body) return null
  const created = asRecord(asRecord(body.playlist).id ? body.playlist : body)
  const id = asNumber(created.id) || asNumber(body.id)
  return id > 0 ? { id, name: asString(created.name) || trimmed } : null
}

export async function neteasePlaylistAddTracks(id: number, trackIds: readonly number[]): Promise<boolean> {
  const ids = trackIds.filter((value) => Number.isSafeInteger(value) && value > 0)
  if (!isUsableId(id) || ids.length === 0) return false
  return (await writeOk('playlist_tracks', { op: 'add', pid: id, tracks: ids.join(',') })) !== null
}

/**
 * 歌单内曲目 id（trackId）与歌曲 id（songId）的对照表。
 *
 * 加歌能用 songId，删歌只能用 trackId：playlist/manipulate/tracks 的 trackIds 指
 * 的是「这首歌在这张歌单里的那一条」，拿 songId 去删上游不认（实测返回失败且
 * 歌没动）。详情里 tracks 与 trackIds 同序等长，按位置对起来即可。
 */
async function playlistTrackIdMap(playlistId: number): Promise<Map<number, number>> {
  const res = await call('playlist_detail', { id: playlistId, n: 1000, s: 0 })
  const playlist = asRecord(asRecord(res.body).playlist)
  const tracks = asArray(playlist.tracks).map((row) => asRecord(row))
  const trackIds = asArray(playlist.trackIds).map((row) => asRecord(row))
  const out = new Map<number, number>()
  for (let index = 0; index < tracks.length; index += 1) {
    const songId = asNumber(tracks[index].id)
    const row = trackIds[index]
    const trackId = row ? asNumber(row.id) : 0
    if (songId > 0 && trackId > 0) out.set(songId, trackId)
  }
  return out
}

export async function neteasePlaylistRemoveTracks(id: number, songIds: readonly number[]): Promise<boolean> {
  const ids = songIds.filter((value) => Number.isSafeInteger(value) && value > 0)
  if (!isUsableId(id) || ids.length === 0) return false
  const map = await playlistTrackIdMap(id)
  const trackIds: number[] = []
  for (const songId of ids) {
    const trackId = map.get(songId)
    if (trackId) trackIds.push(trackId)
  }
  if (trackIds.length === 0) return false
  return (await writeOk('playlist_tracks', { op: 'del', pid: id, tracks: trackIds.join(',') })) !== null
}

export async function neteasePlaylistRename(id: number, name: string): Promise<boolean> {
  const trimmed = String(name ?? '').trim()
  if (!isUsableId(id) || !trimmed) return false
  return (await writeOk('playlist_name_update', { id, name: trimmed })) !== null
}

export async function neteasePlaylistDelete(id: number): Promise<boolean> {
  if (!isUsableId(id)) return false
  const wrote = (await writeOk('playlist_delete', { id })) !== null
  /*
   * 这条接口的成功回包不稳：实测歌单已经删掉了，回包却不是 200。删是不可逆的，
   * 报错会让用户以为没删成再点一次，所以以「列表里还在不在」为准，不以回包为准。
   */
  const left = await neteaseMyPlaylists().catch(() => null)
  if (left) return !left.some((row) => row.id === id)
  return wrote
}

/**
 * 新碟上架（`album_newest`）。
 *
 * 不需要账号：首页「推荐专辑」要的是平台在推什么，不是我的收藏。
 * 注意别用 `top_album`：那条回的是 { weekData, monthData }，没有 albums 数组。
 */
export async function neteaseTopAlbums(limit = 24, offset = 0): Promise<NeteaseCollectedAlbum[]> {
  await bootstrapOnce()
  const res = await call('album_newest', {
    area: 'ALL',
    limit: clamp(limit, 1, 60),
    offset: Math.max(0, offset)
  })
  return asArray(asRecord(res.body).albums)
    .map((entry) => {
      const raw = asRecord(entry)
      const albumId = asNumber(raw.id)
      if (!albumId) return null
      const artists = asArray(raw.artists)
        .map((item) => asString(asRecord(item).name))
        .filter(Boolean)
      const artistId = asNumber(asRecord(asArray(raw.artists)[0]).id)
      return {
        id: albumId,
        name: asString(raw.name),
        coverUrl: asNullableString(raw.picUrl),
        artistName: artists.join(' / ') || asString(asRecord(raw.artist).name),
        artistId,
        year: yearOf(raw.publishTime),
        songCount: asNumber(raw.size)
      }
    })
    .filter((entry): entry is NeteaseCollectedAlbum => entry !== null)
}

/**
 * 关注的艺人（artist_sublist）。跟收藏专辑同一条账号通道，未登录一样返回空。
 */
export async function neteaseArtistSublist(
  limit = 500,
  offset = 0
): Promise<NeteaseFollowedArtist[]> {
  await bootstrapOnce()
  if (!(await safeAccount())) return []
  const res = await call('artist_sublist', { limit: clamp(limit, 1, 500), offset: Math.max(0, offset) })
  // 和 album_sublist 一样：实测放 data，老文档写 sub。
  const body = asRecord(res.body)
  const rows = asArray(body.data).length > 0 ? asArray(body.data) : asArray(body.sub)
  return rows
    .map((entry) => {
      const raw = asRecord(entry)
      const artistId = asNumber(raw.id)
      if (!artistId) return null
      return {
        id: artistId,
        name: asString(raw.name),
        avatarUrl: asNullableString(raw.picUrl) ?? asNullableString(raw.img1v1Url),
        albumCount: asNumber(raw.albumSize),
        musicCount: asNumber(raw.musicSize)
      }
    })
    .filter((entry): entry is NeteaseFollowedArtist => entry !== null)
}

/**
 * 收藏的专辑（album_sublist）。未登录返回空：收藏页该空着，不是报错。
 */
export async function neteaseAlbumSublist(
  limit = 500,
  offset = 0
): Promise<NeteaseCollectedAlbum[]> {
  await bootstrapOnce()
  if (!(await safeAccount())) return []
  const res = await call('album_sublist', { limit: clamp(limit, 1, 500), offset: Math.max(0, offset) })
  // 实测这个端点把列表放在 `data`，老的社区文档写的是 `sub`；两个都认。
  const body = asRecord(res.body)
  const rows = asArray(body.data).length > 0 ? asArray(body.data) : asArray(body.sub)
  return rows
    .map((entry) => {
      const raw = asRecord(entry)
      const albumId = asNumber(raw.id)
      if (!albumId) return null
      const artists = asArray(raw.artists)
        .map((item) => asString(asRecord(item).name))
        .filter(Boolean)
      const artistId = asNumber(asRecord(asArray(raw.artists)[0]).id)
      const fallback = asString(asRecord(raw.artist).name)
      return {
        id: albumId,
        name: asString(raw.name),
        coverUrl: asNullableString(raw.picUrl),
        artistName: artists.join(' / ') || fallback,
        artistId,
        year: yearOf(raw.publishTime),
        songCount: asNumber(raw.size)
      }
    })
    .filter((entry): entry is NeteaseCollectedAlbum => entry !== null)
}
