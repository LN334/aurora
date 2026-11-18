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

// --- the upstream server ------------------------------------------------

/**
 * 上游现在是一个本地 HTTP 服务，不再是 require 进主进程的纯函数。
 *
 * `@yakult-green-tea/qq-music-api` 是 Koa 应用，`electron/qq/local-server.ts` 把它
 * 起在 127.0.0.1 的一个随机端口上，这里所有请求都走 fetch。换包换掉的正是这一层：
 * 签名、协议、接口路径全在包里，Aurora 只剩「发请求、包形状、读结论」。
 *
 * 认证也不是 QQ 原生 cookie 了。包自己签发会话 token，`session.ts` 里的 `cookie`
 * 字段现在装的就是它 —— 字段名没变，调用它的十几个地方一行都不用动。
 */
interface UpstreamResult {
  status: number
  body: unknown
}

/**
 * 发一次请求，永远返回 `{ status, body }`。
 *
 * 不抛错的理由和 `playInfoOf` 那条一样：normalize.ts 的每个读取器都以这个信封为
 * 输入，而「上游回了 401」和「本地服务没起来」对用户是两种完全不同的失败，必须能
 * 分开报。status 0 专门表示后者。
 */
async function call(
  pathname: string,
  options: {
    query?: Record<string, string | number | undefined>
    token?: string
    method?: 'GET' | 'POST'
    body?: unknown
  } = {}
): Promise<UpstreamResult> {
  // 动态 import：这个模块同时被 `node --test` 当 TypeScript 直接加载（见文件头），
  // 静态 import 一个依赖 electron 的模块会让那些纯函数测试起不来。
  const { ensureServer } = await import('./local-server.ts')
  const base = await ensureServer()
  if (!base) return { status: 0, body: { error: 'qq upstream not running' } }

  const url = new URL(pathname, base)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }

  const headers: Record<string, string> = {}
  // 包的解析顺序是「x-qq-session 头 > ?cookie= > qqmusic_session cookie」。空串会被
  // 当成「有会话但无效」，所以只有真拿到 token 时才带这个头。
  if (options.token) headers['x-qq-session'] = options.token

  let payload: string | undefined
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(options.body)
  }

  const response = await fetch(url, { method: options.method ?? 'GET', headers, body: payload })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    /* 上游偶尔回 HTML 错误页，保留原文比丢成 null 好查 */
  }
  return { status: response.status, body: parsed }
}

/** 把包归一化过的行数组包回旧信封，normalize.ts 因此一行不改。 */
function wrapResponse(data: Record<string, unknown>): unknown {
  return { response: { code: 0, data } }
}

// --- sdk surface --------------------------------------------------------

export async function requestSearch(params: {
  keywords: string
  limit: number
  page?: number
}): Promise<unknown> {
  const result = await call('/search', {
    query: { keyword: params.keywords, type: 'song', limit: params.limit, page: params.page ?? 1 }
  })
  const body = asRecord(result.body)
  /*
   * 包把搜索结果归一化成 `{code, items}`，而 normalizeSearch 读的是老 fcg 的
   * `body.response.data.song.list`。包回去比改那个有快照测试的读取器便宜得多，也让
   * 「相关歌手/相关专辑」这些 zhida 块保持原样往下传。
   */
  return {
    status: result.status,
    body: wrapResponse({
      song: { list: asArray(body.items) },
      zhida: asRecord(body.zhida),
      hotalbum: asRecord(body.hotalbum)
    })
  }
}

export async function requestPlay(params: {
  songmid: string
  quality: QqFormat
  mediaMid: string
  cookie: string
}): Promise<unknown> {
  const result = await call('/getMusicPlay', {
    query: {
      songmid: params.songmid,
      quality: params.quality,
      mediaId: params.mediaMid,
      // 非 'play' 让匿名分支回完整 musicu 信封；登录分支不看这个参数。
      resType: 'raw'
    },
    token: params.cookie
  })

  const body = asRecord(result.body)
  const data = asRecord(body.data)
  // 匿名分支：`req_0.data.midurlinfo` 与 `sip` 原样——playInfoOf 直接能读。
  if (Object.keys(asRecord(data.req_0)).length > 0) return result

  /*
   * 登录分支只回 `data.playUrl[songmid] = {url, error, restriction}`，url 已经是拼好
   * 的完整地址。playInfoOf 认的是「sip + purl」两半，所以拆回两半比改它稳——那个
   * 函数有快照测试，而且是判断「要会员」还是「真出错」的唯一依据。
   */
  const entry = asRecord(asRecord(data.playUrl)[params.songmid])
  const url = asString(entry.url)
  let sip = ''
  let purl = ''
  if (url) {
    try {
      const parsed = new URL(url)
      sip = parsed.origin
      purl = parsed.pathname + parsed.search
    } catch {
      purl = url
    }
  }
  const restriction = asRecord(entry.restriction)
  return {
    status: result.status,
    body: {
      data: {
        code: result.status === 200 ? 0 : result.status,
        req_0: {
          code: 0,
          data: {
            midurlinfo: [
              { purl, result: numberOrNull(asRecord(restriction.codes).result), filename: '' }
            ],
            sip: sip ? [sip] : []
          }
        }
      }
    }
  }
}

export async function requestLyric(params: {
  songmid: string
  /** Used only when the mid is unknown; the lyric route accepts either. */
  songid: string
  cookie: string
}): Promise<unknown> {
  // normalizeLyrics 读 `body.response`，包回的正是这个形状，直接透传。
  return await call('/getLyric', {
    query: { songmid: params.songmid, songid: params.songid, trans: 1 },
    token: params.cookie
  })
}

export async function requestComments(params: {
  songId: string
  offset: number
  limit: number
}): Promise<unknown> {
  /*
   * 走包里的 `/comment/hot`：它把网页端 `CommentRead.GetHotCommentList` 的回包
   * 翻成 `{ comments: [{id, content, nick, avatar, praiseCount, time, replyCount}], total, more }`。
   * 直接打 `c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg` 也通（实测），
   * 但那个端点的 GB2312 编码与网页 cookie 细节已经由包处理过，没必要再抄一遍。
   */
  return await call('/comment/hot', {
    query: { id: params.songId, limit: params.limit, offset: params.offset }
  })
}

export async function requestLoginQr(): Promise<unknown> {
  // 第一步拿 unikey，第二步用它换二维码图。整条扫码链路都归包管，Aurora 只收两件东西。
  const key = await call('/login/qr/key', { query: { channel: 'qq' } })
  const unikey = asString(asRecord(asRecord(key.body).data).unikey)
  if (!unikey) return { status: key.status, body: { error: 'no unikey', raw: key.body } }
  const created = await call('/login/qr/create', { query: { key: unikey } })
  const qrimg = asString(asRecord(asRecord(created.body).data).qrimg)
  /*
   * 旧读取器 normalizeQr 认 `{qrsig, ptqrtoken, img}`：前两个是 QQ 网页登录的两步
   * 令牌，两个都必须非空，否则整张码被判成无效。现在整条链路都归包管，Aurora 只需
   * 要「凭据」和「图」，所以 unikey 同时占这两个位置——轮询时原样带回即可。
   */
  return { status: created.status, body: { qrsig: unikey, ptqrtoken: unikey, img: qrimg } }
}

export async function requestLoginQrCheck(params: {
  ptqrtoken: string
  qrsig: string
}): Promise<unknown> {
  const result = await call('/login/qr/check', { query: { key: params.qrsig } })
  const body = asRecord(result.body)
  const code = numberOrNull(body.code)
  /*
   * 包回的是 `{code, cookie}`：803 表示扫码已确认，cookie 里是 `qqmusic_session=<token>`。
   * token 只有一个来源，所以在这里就抽出来，往上一层不需要知道 cookie 串长什么样。
   */
  const token = /qqmusic_session=([^;]+)/.exec(asString(body.cookie))?.[1] ?? ''
  return {
    status: result.status,
    body: {
      code,
      message: asString(body.message),
      // 旧读取器 readQrCheck 读 `isOk`、`refresh` 与 `session.cookie`，三样都得给。
      isOk: code === 803,
      // QQ 的过期码是 800；不转成 `refresh` 的话，扫过期的码会一直显示「等待扫码」。
      refresh: code === 800,
      session: token ? { cookie: token, uin: '', euin: '' } : null
    }
  }
}

/**
 * 账号资料，同时充当「这个会话还活着吗」的探针。
 *
 * `readAccountProbe` 只认两种结论：`response.code: 0` 是已登录，`1000` 是未登录。
 * 包改成了 HTTP 语义（200 + `{profile}` / 401 + `{code: 401}`），所以这里翻译一次，
 * 让「401」与「凭证被上游拒了」在读取器里仍然是那同一个 1000。
 */
export async function requestAccount(params: { uin: string; cookie: string }): Promise<unknown> {
  const result = await call('/user/detail', { token: params.cookie })
  if (result.status === 200) {
    const profile = asRecord(asRecord(result.body).profile)
    return { status: 200, body: { response: { code: 0, data: profile } } }
  }
  return { status: result.status, body: { response: { code: 1000 } } }
}

/**
 * 会员状态。
 *
 * 包回 `{code: 200, isVip, vipLevel, upstream}`，而 `readVipProbe` 读的是老 musicu
 * 信封 `response.req_1.data.identity`，并且把 `code: 0` 当作「上游确实答了」。所以
 * 这里把三样旗标摊回身份对象：`isVip` 是主判据，其余原样带着给等级判断用。
 */
export async function requestVipInfo(params: { cookie: string }): Promise<unknown> {
  const result = await call('/user/vip', { token: params.cookie })
  const body = asRecord(result.body)
  const answered = result.status === 200 && numberOrNull(body.code) === 200
  if (!answered) return { status: result.status, body: { response: { code: -1, req_1: { code: -1 } } } }
  const identity = {
    ...asRecord(body.upstream),
    isVip: body.isVip === true,
    vipLevel: asString(body.vipLevel)
  }
  return {
    status: 200,
    body: { response: { code: 0, req_1: { code: 0, data: { identity } } } }
  }
}

// --- library ------------------------------------------------------------

/** 当前账号自己的歌单。包回 `{code, ...}`，读取器有 `body ?? response` 兜底。 */
export async function requestMyPlaylists(params: {
  uin: string
  cookie: string
  offset?: number
  limit?: number
}): Promise<unknown> {
  return await call('/user/playlist', {
    query: { uid: params.uin, offset: params.offset ?? 0, limit: params.limit ?? 60 },
    token: params.cookie
  })
}

export async function requestPlaylistTracks(params: {
  disstid: string
  cookie: string
}): Promise<unknown> {
  return await call('/getSongListDetail', { query: { disstid: params.disstid }, token: params.cookie })
}

/** 新歌速递。normalizeNewSongs 读 `body.response.new_song.data.songlist`，包回这一层。 */
export async function requestNewSongs(params: { areaId?: number; limit: number }): Promise<unknown> {
  const result = await call('/recommend/new-songs', { query: { area: params.areaId, limit: params.limit } })
  const body = asRecord(result.body)
  return {
    status: result.status,
    body: { response: { new_song: { data: { songlist: asArray(body.songs) } } } }
  }
}

/** 「我喜欢」的曲目。包回 `{code, songs, total, more}`，行结构与搜索一样。 */
export async function requestLikedSongs(params: { uin: string; cookie: string }): Promise<unknown> {
  return await call('/user/liked-songs', { query: { offset: 0, limit: 200 }, token: params.cookie })
}

/**
 * One album's head.
 *
 * The detail route is keyed by albummid only - the numeric id is not accepted -
 * so callers resolve mid first and pass it here.
 */
export async function requestAlbumInfo(params: { albummid: string }): Promise<unknown> {
  return await call('/getAlbumInfo', { query: { albummid: params.albummid } })
}

/** One album's tracklist. The package pages this one itself via begin/limit. */
export async function requestAlbumSongs(params: {
  albummid: string
  begin?: number
  limit?: number
}): Promise<unknown> {
  return await call('/getAlbumInfo', {
    query: {
      albummid: params.albummid,
      begin: params.begin ?? 0,
      limit: params.limit ?? 200
    }
  })
}

/** 这个账号在平台上收藏的专辑。包回 `{code, albums, total, more}`。 */
export async function requestCollectedAlbums(params: {
  uin: string
  cookie: string
  page?: number
  limit?: number
}): Promise<unknown> {
  return await call('/user/albums', {
    query: {
      offset: ((params.page ?? 1) - 1) * (params.limit ?? 60),
      limit: params.limit ?? 60
    },
    token: params.cookie
  })
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
 * QQ 的「我喜欢」。
 *
 * 这一版直连 musicu，不走包里的路由：登录态与 `comm` 这里本来就有一份，而返回的
 * `code` 能直接回答「成没成」，不用再翻译一层 HTTP 状态码。协议照
 * `@yakult-green-tea/qq-music-api` 3.3.x 的 songLike 服务写：
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


/** Mac 版首页里的一张歌单卡。 */
interface MacHomePlaylist {
  rid: string
  name: string
  cover: string | null
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole
    }
    return HTML_ENTITIES[body] ?? whole
  })
}

/**
 * 从 Mac 版首页里抠「为你推荐」那一栏的歌单卡。
 *
 * 为什么是这一栏：`playlist.web_srf` 那三条个人推荐接口现在对所有人回
 * 500003，只剩下公开榜。Mac 版首页仍然登录给一份个人向推荐——第一张是
 * 「今日私享」，后面是「每个周五听点新的」这类歌单，卡上带 `data-rid`。
 * 公开榜只能当兜底，这一栏才是「按你的口味推」。
 *
 * 只取第一个 `mod_for_u` 段里的第一组 `ul.mod_playlist`：同一段后面的
 * 「新歌速递」卡也带 `data-rid`，但那是歌曲 id，混进来会点开错的东西。
 */
export function parseMacHomePlaylists(html: string): MacHomePlaylist[] {
  const start = html.indexOf('mod_for_u')
  if (start < 0) return []
  const section = html.slice(start, start + 60000)
  const list = /<ul[^>]*mod_playlist[^>]*>([\s\S]*?)<\/ul>/.exec(section)
  const body = list ? list[1] : section
  const cards = body.match(/<li[^>]*playlist__item[\s\S]*?<\/li>/g) ?? []
  const rows: MacHomePlaylist[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    const rid = /data-rid="(\d+)"/.exec(card)
    if (!rid) continue
    const name = /<h3[^>]*playlist__name[^>]*>\s*<a[^>]*>([^<]+)<\/a>/.exec(card)
    if (!name) continue
    const label = decodeEntities(name[1]).trim()
    if (!label || seen.has(rid[1])) continue
    seen.add(rid[1])
    const cover = /<img[^>]*class="playlist__pic"[^>]*src="([^"]+)"/.exec(card)
    rows.push({ rid: rid[1], name: label, cover: cover ? decodeEntities(cover[1]) : null })
  }
  return rows
}

/** 拉一次 Mac 版首页并解析。页面对游客也给，但个人那一栏只对登录账号出现。 */
export async function requestMacHomePlaylists(params: { cookie: string }): Promise<MacHomePlaylist[]> {
  const response = await fetch('https://c.y.qq.com/node/musicmac/v6/index.html', {
    headers: {
      referer: 'https://y.qq.com/',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      cookie: params.cookie
    }
  })
  if (!response.ok) return []
  return parseMacHomePlaylists(await response.text())
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


/**
 * Singers this profile follows on the platform.
 *
 * 上游是 `music.concern.RelationList` / `GetFollowSingerList`（实测 2026-11-15
 * 用户重登后仍可用）：请求体只有 `From` / `Size`，不带 `HostUin` 时按登录账号
 * 自己算，返回 `{code:0, req:{code:0, data:{Total, List[]}}}`，每行是
 * `{MID, EncUin, Name, Desc, AvatarUrl, FanNum}`——**只有 mid，没有数字 id**。
 *
 * 以前走的是 `getUserFollowSingers`（包内实现打 `rsc/fcgi-bin/fcg_order_singer_
 * getlist.fcg`）：那个 CGI 现在带任何 `g_tk` 都回 HTTP 500、不带回
 * `{code:1006, msg:"g_token is wrong"}`，网页版 cookie 里也没有 `skey` 可以算
 * `g_tk`，所以整条废弃。
 */
export async function requestFollowedArtists(params: {
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
    req: {
      module: 'music.concern.RelationList',
      method: 'GetFollowSingerList',
      param: { From: 0, Size: params.limit ?? 100 }
    }
  }
  const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      referer: 'https://y.qq.com/portal/profile.html',
      cookie: params.cookie
    },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    return { status: response.status, body: { error: 'followed artists http ' + response.status } }
  }
  return { status: 200, body: await response.json() }
}

/**
 * 「今日私享」那张歌单的 id。
 *
 * `get_recommend` 现在对所有人都回 500003 / 860100005 —— 登录、匿名、带不带
 * cookie 都一样，所以日推不能走那条路。Mac 版首页的 HTML 里，登录账号的「为你
 * 推荐」会多出一张「今日私享」卡，卡上的 `data-rid` 就是日推歌单的 id；拿到它
 * 之后走普通的歌单详情接口即可（那条一直是通的）。
 *
 * 游客拿到的是同一张页面，但那一栏叫「官方歌单」，没有这张卡 —— 所以必须带 cookie。
 */
export async function requestDailyPlaylistId(params: { cookie: string }): Promise<string | null> {
  const rows = await requestMacHomePlaylists(params)
  const today = rows.find((row) => row.name.includes('今日私享'))
  return today ? today.rid : null
}
