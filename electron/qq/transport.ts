import type { QqQuality } from './types'

/**
 * The QQ wire layer: the two-step vkey exchange, the file-name rules, the
 * cookie format, and the error codes.
 *
 * The upstream package does the HTTP, so what is left - and what actually
 * matters to Aurora - is everything *around* the request: how a `sip` domain is
 * chosen, how `purl` becomes a URL, how the per-song `result` code is read, and
 * how a session cookie is taken apart. Those are the parts whose behaviour we
 * depend on, so they are written out here in the open where they can be tested,
 * instead of being left to a dependency's internal helper.
 *
 * Why the two-step matters at all: QQ never returns a playable address in one
 * go. `vkey.GetVkeyServer/CgiGetVkey` answers with a `sip` (one or more CDN
 * hosts) plus a `midurlinfo` entry per song, and the playable URL only exists
 * once the two are joined. Dropping the vkey answers 403, and the join is the
 * only place where a wrong assumption shows up as silence rather than an error.
 *
 * The module imports nothing at runtime - the package is required lazily inside
 * the functions, and the readers below are local on purpose. A shared helper
 * module would be a relative runtime import, which Node's ESM resolver rejects
 * without a file extension, and `tsc` rejects *with* one; keeping each pure
 * module self-contained is what makes `node --test` able to load it. Folia's
 * per-platform files do the same thing for the same reason.
 */

// --- quality ------------------------------------------------------------

/** The upstream's own format tokens. */
 type QqFormat = '128' | '320' | 'm4a' | 'flac' | 'ape'

 interface QualityFormat {
  /** The file-name prefix the CDN expects. */
  prefix: string
  suffix: string
  /** True when the format is bit-perfect, i.e. must not be offered as a fallback. */
  lossless: boolean
}

/**
 * Prefix and extension per format, straight from the upstream file-naming
 * scheme (`M500`/`C400`/`M800`/`F000`/`A000`).
 *
 * `m4a` is listed as lossy because it is AAC; upstream publishes no bitrate for
 * it, so nothing here claims one.
 */
export const QUALITY_FORMATS: Record<QqFormat, QualityFormat> = {
  '128': { prefix: 'M500', suffix: '.mp3', lossless: false },
  '320': { prefix: 'M800', suffix: '.mp3', lossless: false },
  m4a: { prefix: 'C400', suffix: '.m4a', lossless: false },
  flac: { prefix: 'F000', suffix: '.flac', lossless: true },
  ape: { prefix: 'A000', suffix: '.ape', lossless: true }
}

/**
 * The shared tiers, mapped onto the formats upstream actually serves.
 *
 * `higher` maps to 128k on purpose: this interface exposes no 192k tier (the
 * package's format table has no `M`-prefix between `M500` and `M800`), and
 * answering it with `m4a` would make it *worse* than `standard`, which is a
 * ladder no user can reason about. The tier therefore resolves to the same
 * stream as `standard`, and the reply reports the achieved level so the
 * interface never claims otherwise.
 */
export const TIER_FORMATS: Record<
  QqQuality,
  { format: QqFormat; bitrate: number; lossless: boolean }
> = {
  standard: { format: '128', bitrate: 128, lossless: false },
  higher: { format: '128', bitrate: 128, lossless: false },
  exhigh: { format: '320', bitrate: 320, lossless: false },
  // 999 is this app's existing marker for a lossless stream; the renderer's own
  // fallback table uses the same number, so the two cannot disagree.
  lossless: { format: 'flac', bitrate: 999, lossless: true }
}

/**
 * The tiers to try for a request, best first.
 *
 * Upstream refuses a tier it will not serve with an empty `purl` rather than an
 * error - verified live: a *free* track answers 320k and FLAC with
 * `result=104003` while 128k succeeds. A client that stopped at the refusal
 * would be silent for every user who has not signed in, and the default tier is
 * `exhigh`. Walking down the ladder is what a real client does, and the reason
 * code stays honest because it is only reported once the last tier is refused
 * too.
 */
export function tierLadder(quality: QqQuality): QqQuality[] {
  const order: QqQuality[] = ['lossless', 'exhigh', 'standard']
  const start = order.indexOf(quality)
  if (start === -1) return ['standard']
  return order.slice(start)
}

 function formatOf(format: QqFormat): QualityFormat {
  return QUALITY_FORMATS[format]
}

/**
 * The file name to ask the vkey server for.
 *
 * Verified against the live service: `prefix + songmid + mediaMid + suffix` is
 * what upstream expects, and it echoed exactly that back in `midurlinfo[0]`.
 * When `mediaMid` is unknown the songmid is repeated, which upstream still
 * resolves - the field is a refinement, not a requirement.
 */
export function qualityFilename(songmid: string, mediaMid: string, quality: QqFormat): string {
  const format = formatOf(quality)
  return `${format.prefix}${songmid}${mediaMid || songmid}${format.suffix}`
}

// --- url assembly -------------------------------------------------------

/**
 * Choose the CDN host.
 *
 * The same preference the installed package uses (verified by reading its
 * `pickPlayableDomain`): skip the `http://ws` streaming hosts first, then
 * prefer an https entry, then take whatever is left. Duplicating the rule is
 * deliberate - it is one of the two things that decide whether playback works,
 * so it belongs somewhere Aurora can see and test it.
 */
export function pickSipDomain(sip: unknown): string {
  if (!Array.isArray(sip)) return ''
  const urls = sip.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return (
    urls.find((url) => !url.startsWith('http://ws')) ??
    urls.find((url) => url.startsWith('https://')) ??
    urls[0] ??
    ''
  )
}

export function joinUrl(domain: string, path: string): string {
  if (!domain) return ''
  if (domain.endsWith('/') && path.startsWith('/')) return `${domain}${path.slice(1)}`
  if (!domain.endsWith('/') && !path.startsWith('/')) return `${domain}/${path}`
  return `${domain}${path}`
}

/** `sip` + `purl` -> the address the renderer proxies. Empty when there is no purl. */
export function buildPlayUrl(sip: unknown, purl: unknown): string {
  const path = typeof purl === 'string' ? purl : ''
  if (!path) return ''
  return joinUrl(pickSipDomain(sip), path)
}

// --- reading the play response -----------------------------------------

 interface PlayInfo {
  /** `data.code` (or `body.code`): the request-level verdict. */
  envelopeCode: number | null
  /** `data.req_0.code`: the module-level verdict. */
  requestCode: number | null
  /** The playable path, empty when upstream refused. */
  purl: string
  /** Per-song verdict from `midurlinfo[0]`; 0 means "went through". */
  result: number | null
  /** The file name upstream built for us, useful for diagnosing a mismatch. */
  filename: string
  /** The joined address, empty when upstream refused. */
  url: string
}

/**
 * Pull the fields Aurora cares about out of a `resType: 'raw'` play response.
 *
 * Raw rather than the package's cooked `playUrl` shape: the cooked form drops
 * `midurlinfo`, and `midurlinfo[].result` is the only field that distinguishes
 * "needs a membership" from "this went wrong", which is the distinction the
 * whole failure vocabulary rests on.
 */
export function playInfoOf(response: unknown): PlayInfo {
  const body = asRecord(asRecord(response).body)
  // `resType: 'raw'` returns the musicu envelope itself under `data`.
  const data = asRecord(body.data)
  const request = asRecord(data.req_0)
  const requestData = asRecord(request.data)
  const info = asArray(requestData.midurlinfo).map(asRecord)[0] ?? {}

  const purl = asString(info.purl)
  return {
    envelopeCode: numberOrNull(data.code) ?? numberOrNull(body.code),
    requestCode: numberOrNull(request.code),
    purl,
    result: numberOrNull(info.result),
    filename: asString(info.filename),
    url: buildPlayUrl(requestData.sip, purl)
  }
}

// --- cookies ------------------------------------------------------------

 interface CookieJar {
  [name: string]: string
}

export function parseCookie(cookie: unknown): CookieJar {
  const jar: CookieJar = {}
  if (typeof cookie !== 'string' || !cookie) return jar
  for (const part of cookie.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const name = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim()
    if (name && value) jar[name] = value
  }
  return jar
}

export function cookieValue(cookie: unknown, ...names: string[]): string {
  const jar = parseCookie(cookie)
  for (const name of names) {
    const value = jar[name]
    if (value) return value
  }
  return ''
}

/** Digits of a uin, whether upstream wrote it as `123456` or `o123456`. */
export function uinDigits(value: unknown): string {
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
  const match = /\d{3,}/.exec(text)
  return match ? match[0] : ''
}

/** Whether a cookie carries the two names QQ treats as the login session. */
export function isSessionCookie(cookie: unknown): boolean {
  return Boolean(cookieValue(cookie, 'qqmusic_key', 'qm_keyst'))
}

// --- local readers ------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// --- the upstream package ----------------------------------------------

/**
 * The slice of `@sansenjian/qq-music-api` this client uses.
 *
 * Required lazily, inside the functions below, for the same reason
 * `electron/netease/client.ts` does it: the package pulls in koa, axios and the
 * whole route table, so loading it must not be part of starting Aurora.
 */
interface QqSdk {
  search: (params: Record<string, unknown>) => Promise<unknown>
  getPlayUrl: (params: Record<string, unknown>) => Promise<unknown>
  lyric: (params: Record<string, unknown>) => Promise<unknown>
  getQQLoginQr: () => Promise<unknown>
  checkQQLoginQr: (params: Record<string, unknown>) => Promise<unknown>
}

interface QqServices {
  getUserDetail: (params: Record<string, unknown>) => Promise<unknown>
  getVipInfo: (params: Record<string, unknown>) => Promise<unknown>
  getUserPlaylists: (params: Record<string, unknown>) => Promise<unknown>
  songListDetail: (params: Record<string, unknown>) => Promise<unknown>
  getDailyRecommend: (params: Record<string, unknown>) => Promise<unknown>
  getNewSongs: (areaId?: number, limit?: number) => Promise<unknown>
  getUserLikedSongs: (params: Record<string, unknown>) => Promise<unknown>
  getUserCollectedAlbums: (params: Record<string, unknown>) => Promise<unknown>
  getAlbumInfo: (params: Record<string, unknown>) => Promise<unknown>
  getAlbumSongs: (params: Record<string, unknown>) => Promise<unknown>
}

const SDK_PACKAGE = '@sansenjian/qq-music-api/sdk'
const SERVICES_PACKAGE = '@sansenjian/qq-music-api/services'

let sdk: QqSdk | null = null
let services: QqServices | null = null

/**
 * Load the SDK, once.
 *
 * Exported so `status()` can report "the dependency is missing or broken" as a
 * detail string instead of every call failing with an unrelated message.
 */
export function loadSdk(): QqSdk {
  if (!sdk) sdk = require(SDK_PACKAGE) as QqSdk
  return sdk
}

/**
 * Load the service bundle, once.
 *
 * `./services` is already in memory by the time `./sdk` is loaded - the SDK is
 * a thin wrapper over it - so this costs nothing extra. It is used for the two
 * calls the SDK does not wrap: the account lookup that doubles as a login
 * liveness probe, and the membership endpoint.
 */
 function loadServices(): QqServices {
  if (!services) services = require(SERVICES_PACKAGE) as QqServices
  return services
}

export async function requestSearch(params: {
  keywords: string
  limit: number
  page?: number
}): Promise<unknown> {
  return await loadSdk().search({ key: params.keywords, limit: params.limit, page: params.page ?? 1 })
}

export async function requestPlay(params: {
  songmid: string
  quality: QqFormat
  mediaMid: string
  cookie: string
}): Promise<unknown> {
  return await loadSdk().getPlayUrl({
    songmid: params.songmid,
    quality: params.quality,
    // `raw` keeps `midurlinfo` (and therefore `result`) in the response; the
    // default `play` mode throws it away. See `playInfoOf`.
    resType: 'raw',
    mediaId: params.mediaMid,
    cookie: params.cookie
  })
}

export async function requestLyric(params: {
  songmid: string
  /** Used only when the mid is unknown; the lyric route accepts either. */
  songid: string
  cookie: string
}): Promise<unknown> {
  // `isFormat` stays off so upstream hands back the LRC text itself rather than
  // a parsed line array, which is what the renderer's lyric parser expects.
  return await loadSdk().lyric({
    songmid: params.songmid,
    songid: params.songid,
    cookie: params.cookie
  })
}

export async function requestLoginQr(): Promise<unknown> {
  return await loadSdk().getQQLoginQr()
}

export async function requestLoginQrCheck(params: {
  ptqrtoken: string
  qrsig: string
}): Promise<unknown> {
  return await loadSdk().checkQQLoginQr({ ptqrtoken: params.ptqrtoken, qrsig: params.qrsig })
}

export async function requestAccount(params: { uin: string; cookie: string }): Promise<unknown> {
  return await loadServices().getUserDetail({ uin: params.uin, cookie: params.cookie })
}

export async function requestVipInfo(params: { cookie: string }): Promise<unknown> {
  return await loadServices().getVipInfo({ cookie: params.cookie })
}

// --- library ------------------------------------------------------------

/**
 * The profile's own playlists, and the three catalogue reads the bridge needs.
 *
 * All four go through `./services` rather than `./sdk`: the SDK wraps only the
 * seven calls the original web player used, while the service bundle exports the
 * whole client surface. The cookie is passed the way each route reads it -
 * `cookie` for the profile page and the recommend routes, an explicit
 * `option.headers.Cookie` for the playlist detail route, which would otherwise
 * answer an anonymous payload.
 */
export async function requestMyPlaylists(params: {
  uin: string
  cookie: string
  offset?: number
  limit?: number
}): Promise<unknown> {
  return await loadServices().getUserPlaylists({
    uin: params.uin,
    offset: params.offset ?? 0,
    limit: params.limit ?? 60,
    cookie: params.cookie
  })
}

export async function requestPlaylistTracks(params: {
  disstid: string
  cookie: string
}): Promise<unknown> {
  return await loadServices().songListDetail({
    method: 'get',
    params: { disstid: params.disstid },
    option: { headers: { Cookie: params.cookie } }
  })
}

/**
 * The new-song shelf.
 *
 * Unlike most of this bundle, `getNewSongs` takes positional arguments
 * (`areaId, limit`) rather than `{ method, params }`. Passing an object there
 * makes the service treat it as an area id and come back empty.
 */
export async function requestNewSongs(params: { areaId?: number; limit: number }): Promise<unknown> {
  return await loadServices().getNewSongs(params.areaId, params.limit)
}

/**
 * 每日推荐。
 *
 * 包里的 getDailyRecommend 把 `param.uin` 与 `param.login` 写死成 0，cookie 传进
 * 去也只会得到一份匿名榜单。所以这一支不走包，自己发同一个 musicu 请求，把真实
 * uin 填进去——接口认的就是这两个字段。
 */
export async function requestDailyRecommend(params: {
  uin: string
  cookie: string
  limit?: number
}): Promise<unknown> {
  const uin = Number(params.uin) || 0
  const body = {
    comm: {
      ct: 24,
      cv: 0,
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      platform: 'yqq.json',
      needNewCode: 0,
      loginUin: uin
    },
    recommend: {
      module: 'music.web_srf_svr',
      method: 'get_recommend',
      param: { page: 0, num: params.limit ?? 30, uin, login: uin > 0 ? 1 : 0 }
    }
  }
  const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://y.qq.com/portal/player.html',
      cookie: params.cookie
    },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    return { status: response.status, body: { error: 'daily recommend http ' + response.status } }
  }
  return { status: 200, body: await response.json() }
}

/**
 * "我喜欢的音乐".
 *
 * 这个接口在 SDK 里读的是包内的全局登录态（`global.userInfo`），完全忽略传进去的
 * cookie；只传 cookie 等于匿名请求，上游一律回 502「获取用户喜欢的歌曲失败」。
 * 所以每次调用前把当前账号的 cookie 塞回那个全局位——覆盖成空也无妨，下一次调用
 * 又会被写成新的那份。
 */
export async function requestLikedSongs(params: { uin: string; cookie: string }): Promise<unknown> {
  const scope = globalThis as { userInfo?: Record<string, unknown> }
  scope.userInfo = {
    loginUin: params.uin,
    uin: params.uin,
    cookie: params.cookie,
    cookieList: [],
    cookieObject: {},
    refreshData: () => ({})
  }
  return await loadServices().getUserLikedSongs({ uin: params.uin, cookie: params.cookie })
}

/**
 * QQ 的「我喜欢」。
 *
 * 包里那一版没有写接口（`@sansenjian/qq-music-api` 只有读），协议抄自
 * `@yakult-green-tea/qq-music-api` 3.3.6 的 songLike 服务：
 *
 *   读 `music.musicasset.SongFavRead / IsSongFanByMid`，回 `data.m_fan[mid]`；
 *   写 `music.musicasset.PlaylistDetailWrite / AddSonglist | DelSonglist`，
 *   `dirId: 201` 就是「我喜欢」这张歌单。
 *
 * 先读一次：状态本来就对，一个字都不用写。写完再读一次核对——上游对扫码登录的
 * cookie 时好时坏（`get_recommend` 一律答 500003 就是这个毛病），读回来对不上
 * 就如实报失败，不替它宣称成功。
 */
/** 一次 musicu 调用。`code` 取 `req_0.code`，非 0 就是上游的拒绝理由。 */
async function musicuRequest(
  comm: unknown,
  headers: Record<string, string>,
  module: string,
  method: string,
  param: Record<string, unknown>
): Promise<{ code: number; data?: unknown }> {
  const body = JSON.stringify({ comm, req_0: { module, method, param } })
  /*
   * 这一层只重试「请求没出去」的情况（连接被重置、DNS、超时），不重试已经拿到
   * 的应答：Add/Del 是幂等的，重发一次不会把状态搞坏；但响应码是上游的结论，
   * 再问一遍只会得到同一个答案。
   */
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST',
        headers,
        body
      })
      if (!response.ok) return { code: -response.status }
      const parsed = (await response.json()) as { req_0?: { code?: number; data?: unknown } }
      const item = parsed?.req_0
      return { code: typeof item?.code === 'number' ? item.code : -1, data: item?.data }
    } catch (error) {
      if (attempt >= 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

/**
 * QQ 的两个 comm，不是一个「风格」，是**两套权限**。实测（见 requestSongLike 的注释）：
 *
 *   * 网页 comm：只读没问题，加歌能过、删歌 80105；带 `g_tk` 才认写。
 *   * 安卓 comm：读写都认，`authst` 必须是 cookie 里的 qqmusic_key。
 *
 * 所以读一律网页 comm（历史原因：它最稳），写一律安卓 comm。
 */
function webComm(uin: number, gtk: string) {
  return {
    ct: 24,
    cv: 0,
    format: 'json',
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    platform: 'yqq.json',
    needNewCode: 0,
    loginUin: uin,
    uin,
    g_tk: Number(gtk) || 0,
    g_tk_new_20200303: Number(gtk) || 0
  }
}

function webHeaders(cookie: string): Record<string, string> {
  return { 'content-type': 'application/json', referer: 'https://y.qq.com/', cookie }
}

function androidComm(uin: number, authst: string) {
  return {
    ct: 11,
    cv: 14090008,
    v: 14090008,
    chid: '10003505',
    tmeAppID: 'qqmusic',
    QIMEI: '',
    QIMEI36: '',
    qq: uin,
    authst,
    tmeLoginType: 2
  }
}

function androidHeaders(cookie: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    cookie,
    'User-Agent': 'QQMusic 14090008(android 10)'
  }
}

export async function requestSongLike(params: {
  uin: string
  cookie: string
  /** cookie 里的 qqmusic_key（或 p_skey）：安卓 comm 的 authst 就是它。 */
  authst: string
  /** hash33(authst)，网页 comm 的 g_tk。 */
  gtk: string
  id: number
  mid: string
  liked: boolean
}): Promise<{ ok: boolean; liked: boolean; detail?: string }> {
  const uin = Number(params.uin) || 0

  /** null = 问不出来（没登录 / 上游答错），不等于「没喜欢」。 */
  const read = async (): Promise<boolean | null> => {
    const answer = await musicuRequest(
      webComm(uin, params.gtk),
      webHeaders(params.cookie),
      'music.musicasset.SongFavRead',
      'IsSongFanByMid',
      { v_songMid: [params.mid] }
    )
    if (answer.code !== 0) return null
    const fan = (answer.data as { m_fan?: Record<string, boolean> } | undefined)?.m_fan
    const value = fan?.[params.mid]
    return typeof value === 'boolean' ? value : null
  }

  const before = await read()
  if (before === params.liked) return { ok: true, liked: before }

  const write = await musicuRequest(
    androidComm(uin, params.authst),
    androidHeaders(params.cookie),
    'music.musicasset.PlaylistDetailWrite',
    params.liked ? 'AddSonglist' : 'DelSonglist',
    { dirId: 201, v_songInfo: [{ songId: params.id, songType: 0 }] }
  )
  if (write.code !== 0) return { ok: false, liked: !params.liked, detail: 'write code ' + write.code }

  const after = await read()
  if (after === null) return { ok: false, liked: !params.liked, detail: 'read back failed' }
  return after === params.liked ? { ok: true, liked: after } : { ok: false, liked: after, detail: 'state mismatch' }
}

// --- 歌单的写 ------------------------------------------------------------
//
// QQ 的歌单不是「一个 id」：`tid`（dissid）给读取与展示，`dirId` 才是写操作的
// 目标；两个都要，且 dirId < 200 才是用户自建的普通歌单（>=200 是系统列表）。
// 所以每个写操作前先读一次 `GetPlaylistByUin`，用 tid 换出 dirId。

interface QqCredential {
  uin: string
  cookie: string
  authst: string
}

export interface QqOwnedPlaylist {
  tid: number
  dirId: number
  name: string
  /** 0 = 自建；其它值是系统目录，不写。 */
  dirType: number
}

/**
 * 我的歌单列表（带 dirId）。
 *
 * `uin` 这一格必须是**字符串**：2026-11 实测，传数字一律答 10006（未登录），
 * 传 `state.uin` 原样就通。所以别在这里 Number() 一下。
 */
export async function requestOwnedPlaylists(params: QqCredential): Promise<QqOwnedPlaylist[]> {
  const uin = Number(params.uin) || 0
  const answer = await musicuRequest(
    androidComm(uin, params.authst),
    androidHeaders(params.cookie),
    'music.musicasset.PlaylistBaseRead',
    'GetPlaylistByUin',
    { uin: params.uin }
  )
  if (answer.code !== 0) return []
  const rows = (answer.data as { v_playlist?: unknown[] } | undefined)?.v_playlist
  if (!Array.isArray(rows)) return []

  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const row = value as Record<string, unknown>
    const tid = Number(row.tid ?? row.dissid)
    const dirId = Number(row.dirId ?? row.dirid)
    if (!Number.isSafeInteger(tid) || tid <= 0 || !Number.isSafeInteger(dirId) || dirId <= 0) return []
    return [
      {
        tid,
        dirId,
        name: typeof row.dirName === 'string' ? row.dirName : '',
        dirType: Number(row.dirType ?? 0) || 0
      }
    ]
  })
}

/**
 * 建一张歌单。
 *
 * 上游只认名字；response 里的 `tid`/`dirId` 是新建的两把钥匙。建完立刻读回
 * 一次，确认这张歌单真的在列表里——「建好了」这类话只在上游承认之后才说。
 */
export async function requestPlaylistCreate(
  params: QqCredential,
  name: string
): Promise<{ tid: number; dirId: number } | null> {
  const uin = Number(params.uin) || 0
  const answer = await musicuRequest(
    androidComm(uin, params.authst),
    androidHeaders(params.cookie),
    'music.musicasset.PlaylistBaseWrite',
    'AddPlaylist',
    { dirName: name }
  )
  if (answer.code !== 0) return null
  const result = (answer.data as { result?: { tid?: unknown; dirId?: unknown } } | undefined)?.result
  const tid = Number(result?.tid)
  const dirId = Number(result?.dirId)
  if (!Number.isSafeInteger(tid) || tid <= 0) return null
  if (!Number.isSafeInteger(dirId) || dirId <= 0 || dirId >= 200) return null

  const list = await requestOwnedPlaylists(params)
  return list.some((row) => row.tid === tid && row.dirId === dirId) ? { tid, dirId } : null
}

export async function requestPlaylistDelete(params: QqCredential, tid: number): Promise<boolean> {
  const uin = Number(params.uin) || 0
  const before = await requestOwnedPlaylists(params)
  const target = before.find((row) => row.tid === tid)
  if (!target || target.dirType !== 0 || target.dirId >= 200) return false

  const answer = await musicuRequest(
    androidComm(uin, params.authst),
    androidHeaders(params.cookie),
    'music.musicasset.PlaylistBaseWrite',
    'DelPlaylist',
    { dirId: target.dirId }
  )
  if (answer.code !== 0) return false

  const after = await requestOwnedPlaylists(params)
  return !after.some((row) => row.tid === tid || row.dirId === target.dirId)
}

/** 加 / 删歌。`songs` 是 `{songId, songType:0}`（实测只认这一种编码）。 */
export async function requestPlaylistTracksEdit(
  params: QqCredential,
  tid: number,
  songIds: number[],
  add: boolean
): Promise<boolean> {
  const uin = Number(params.uin) || 0
  const before = await requestOwnedPlaylists(params)
  const target = before.find((row) => row.tid === tid)
  if (!target || target.dirType !== 0 || target.dirId >= 200) return false

  const answer = await musicuRequest(
    androidComm(uin, params.authst),
    androidHeaders(params.cookie),
    'music.musicasset.PlaylistDetailWrite',
    add ? 'AddSonglist' : 'DelSonglist',
    { dirId: target.dirId, v_songInfo: songIds.map((id) => ({ songId: id, songType: 0 })) }
  )
  return answer.code === 0
}

/**
 * 改名。
 *
 * `EditPlaylist` 的 `mask: 95` 会**同时**接受名字、简介、封面、标签、可见性五个
 * 字段，所以不能只传新名字——那会把简介和封面清空。先把现有值读出来，只替换
 * 名字，其余原样回写。
 */
export async function requestPlaylistRename(
  params: QqCredential,
  tid: number,
  name: string
): Promise<boolean> {
  const uin = Number(params.uin) || 0
  const before = await requestOwnedPlaylists(params)
  const target = before.find((row) => row.tid === tid)
  if (!target || target.dirType !== 0 || target.dirId >= 200) return false

  const comm = androidComm(uin, params.authst)
  const headers = androidHeaders(params.cookie)
  const read = await musicuRequest(comm, headers, 'music.srfDissInfo.aiDissInfo', 'uniform_get_Dissinfo', {
    dirid: target.dirId,
    optype: 3,
    tag: 1,
    userinfo: 0,
    pic_dpi: 300
  })
  const info = (read.data as { dirinfo?: Record<string, unknown> } | undefined)?.dirinfo
  if (read.code !== 0 || !info) return false

  const tags = Array.isArray(info.tag)
    ? info.tag
        .map((item) => (item && typeof item === 'object' ? String((item as { id?: unknown }).id ?? '') : ''))
        .filter(Boolean)
        .join(',')
    : ''

  const answer = await musicuRequest(
    comm,
    headers,
    'music.musicasset.PlaylistBaseWrite',
    'EditPlaylist',
    {
      dirId: target.dirId,
      mask: 95,
      dirNewName: name,
      dirNewDesc: typeof info.desc === 'string' ? info.desc : '',
      dirNewPicUrl: typeof info.picurl === 'string' ? info.picurl : '',
      dirNewPicUrl2: typeof info.picurl2 === 'string' ? info.picurl2 : '',
      dirNewtaglist: tags,
      dirShow: Number(info.dir_show ?? 1) || 1
    }
  )
  if (answer.code !== 0) return false
  const result = (answer.data as { result?: { dirId?: unknown; tid?: unknown } } | undefined)?.result
  return Number(result?.dirId) === target.dirId && Number(result?.tid) === tid
}

/**
 * One album's head.
 *
 * The detail route is keyed by albummid only - the numeric id is not accepted -
 * so callers resolve mid first and pass it here.
 */
export async function requestAlbumInfo(params: { albummid: string }): Promise<unknown> {
  return await loadServices().getAlbumInfo({ method: 'get', params: { albummid: params.albummid } })
}

/** One album's tracklist, paged because a box set can pass 300 rows. */
export async function requestAlbumSongs(params: {
  albummid: string
  begin?: number
  limit?: number
}): Promise<unknown> {
  return await loadServices().getAlbumSongs({
    method: 'post',
    params: { albummid: params.albummid, begin: params.begin ?? 0, limit: params.limit ?? 200 }
  })
}

/**
 * 平台推荐歌单的三种候选路由。
 *
 * 「按标签取歌单」要登录（500003），搜索位只回歌曲，榜单又不是歌单，所以这里
 * 把 QQ 网页端历史上用过的三条歌单推荐路由都试一遍：谁先回来谁算。
 */
/**
 * 歌单广场的公开老接口（fcg_get_diss_by_tag）。
 *
 * QQ 网页端与各家第三方客户端一直用它取「分类 / 热门歌单」，不需要账号；
 * 新式 musicu 路由要登录（500003），先试公开这条。
 */
export async function requestPublicSonglists(limit = 12): Promise<unknown> {
  const url =
    'https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?categoryId=10000000&sortId=5' +
    '&sin=0&ein=' +
    String(Math.max(1, Math.min(40, limit))) +
    '&format=json&platform=yqq.json'
  const response = await fetch(url, {
    headers: {
      referer: 'https://y.qq.com/n/ryqq/playlist',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    }
  })
  // 这个老接口回的是 GBK 的 JSON：直接 .json() 会把中文读成乱码。
  const bytes = new Uint8Array(await response.arrayBuffer())
  const text = new TextDecoder('gbk').decode(bytes)
  return JSON.parse(text)
}

export async function requestRecommendPlaylists(variant: 'a' | 'b' | 'c'): Promise<unknown> {
  const payload =
    variant === 'a'
      ? { playlist: { module: 'playlist.web_srf', method: 'get_recommend', param: { num: 12 } } }
      : variant === 'b'
        ? {
            playlist: {
              module: 'music.playlist.PlaylistInfoServer',
              method: 'get_recommend_playlist',
              param: { num: 12 }
            }
          }
        : {
            playlist: {
              module: 'playlist.web_srf',
              method: 'get_diss_recommend',
              param: { num: 12 }
            }
          }
  return await musicu(payload)
}

/** 一个榜的歌曲。 */
export async function requestTopDetail(params: {
  topId: number
  limit?: number
}): Promise<unknown> {
  return await musicu({
    toplist: {
      module: 'musicToplist.ToplistInfoServer',
      method: 'GetDetail',
      param: { topId: params.topId, offset: 0, num: params.limit ?? 60 }
    }
  })
}

/** 发一次 musicu 请求，把外层信封摊平成 { status, body }，与其它请求一致。 */
async function musicu(payload: Record<string, unknown>): Promise<unknown> {
  const body = {
    comm: {
      ct: 24,
      cv: 0,
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      platform: 'yqq.json',
      needNewCode: 0
    },
    ...payload
  }
  const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://y.qq.com/n/ryqq/toplist/4'
    },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    return { status: response.status, body: { error: 'musicu http ' + response.status } }
  }
  return { status: 200, body: await response.json() }
}

/** Albums this profile collected on the platform. */
export async function requestCollectedAlbums(params: {
  uin: string
  cookie: string
  page?: number
  limit?: number
}): Promise<unknown> {
  return await loadServices().getUserCollectedAlbums({
    uin: params.uin,
    page: params.page ?? 1,
    limit: params.limit ?? 60,
    cookie: params.cookie
  })
}
