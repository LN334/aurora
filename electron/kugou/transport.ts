import type { KugouAlbumDetail, KugouAlbumEntry, KugouArtistDetail, KugouQuality, KugouSong } from './types'

/**
 * 酷狗的线层：本地 vendor 服务的 HTTP，以及「把上游 JSON 读成形状」的读取器。
 *
 * 和 `electron/qq/transport.ts` 的分工一样——但酷狗这里是**我们自己的 HTTP**，
 * 不是懒加载的 SDK：服务是 `vendor/KuGouMusicApi` 这个本地进程，接口是一组
 * 文件名路由（`module/search_song.js` -> `/search/song`），所以真正的线层细节是
 * 三件 Aurora 依赖的事：
 *
 * 1. **每个请求都要绕过 vendor 的两分钟缓存**（`server.js` 对 200 响应
 *    `cache('2 minutes')`）。不绕的话「换一批」会拿到同一批，改完参数也看不出
 *    变化——本项目踩过这个坑，所以 `t=` 参数在这里统一加。
 * 2. **登录态是 Cookie**：`token` + `userid`（扫码成功后 `login_qr_check.js` 会把
 *    它们写进 Set-Cookie，body 里也有）。
 * 3. **字段路径必须来自真机 dump**。本文件里每个读取器上方都标了「实测」或
 *    「未实测（需登录）」，未实测的那几个刻意写成宽容多路径读取，并且主进程会
 *    把原始 key 列表写进 startup.log——等真人登录一次就能收口。
 *
 * 这个文件不做运行时相对 import（`node --test` 要能直接加载），本地工具函数
 * 自带拷贝。
 */

// --- 服务的基地址 --------------------------------------------------------

let base = ''

/** 由 `client.ts` 在本地服务就绪后调用。 */
export function setBaseUrl(url: string): void {
  base = url.replace(/\/+$/, '')
}

// --- 音质 ---------------------------------------------------------------

interface TierFormat {
  /** `/song/url` 的 `quality` 参数。 */
  quality: '128' | '320' | 'flac'
  /** 成功后报给界面的 kbps；999 是本项目表示无损的约定。 */
  bitrate: number
  lossless: boolean
}

/**
 * 四个共享档位到酷狗三档的映射。
 *
 * `higher` 落到 128：酷狗没有 192k 这一档，给 320 会让「higher」比「exhigh」
 * 还好，用户没法理解这个阶梯。和 QQ 的 `higher` 一个解释。
 */
export const TIER_FORMATS: Record<KugouQuality, TierFormat> = {
  standard: { quality: '128', bitrate: 128, lossless: false },
  higher: { quality: '128', bitrate: 128, lossless: false },
  exhigh: { quality: '320', bitrate: 320, lossless: false },
  lossless: { quality: 'flac', bitrate: 999, lossless: true }
}

/**
 * 从请求的档位往下降，试到 standard 为止。
 *
 * 酷狗对拿不到的档位不是报错，而是不给 `url`（登录后同样可能只给低档），所以
 * 阶梯是「能不能放出来」的唯一办法；原因只在最后一档也被拒时才报。
 */
export function tierLadder(quality: KugouQuality): KugouQuality[] {
  const order: KugouQuality[] = ['lossless', 'exhigh', 'standard']
  const start = order.indexOf(quality)
  if (start === -1) return ['standard']
  return order.slice(start)
}

/** 该档位要用的 hash；缺失时返回空串。 */
export function hashForTier(song: KugouSong, tier: KugouQuality): string {
  if (tier === 'lossless') return song.sqHash || ''
  if (tier === 'exhigh') return song.hqHash || ''
  return song.hash || ''
}

// --- HTTP ---------------------------------------------------------------

interface KugouRequestOptions {
  method?: 'GET' | 'POST'
  /** query 参数；`undefined` 的项不发送。 */
  query?: Record<string, string | number | undefined>
  /** Cookie 头，形如 `token=..; userid=..`。 */
  cookie?: string
  /** 超时，默认 12 秒——本地回环，正常是毫秒级。 */
  timeoutMs?: number
}

interface KugouResponse {
  body: unknown
  /** Set-Cookie 原始行（扫码成功时 token/userid 在这里）。 */
  setCookie: string[]
}

class KugouHttpError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'KugouHttpError'
    this.status = status
  }
}

const DEFAULT_TIMEOUT_MS = 12_000

/**
 * 打一次本地 vendor 服务。
 *
 * 失败一律抛 `KugouHttpError`/`Error`，由 `client.ts` 归到原因上；这里不做
 * 「返回空对象」的降级，因为空对象会让「服务没起」看起来像「上游说没有」。
 */
export async function request(
  pathname: string,
  options: KugouRequestOptions = {}
): Promise<KugouResponse> {
  if (!base) throw new Error('酷狗本地服务还没启动')

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue
    query.set(key, String(value))
  }
  // 缓存破坏：见文件头。每次请求一个新值，vendor 的 cache 中间件按 URL 记。
  query.set('t', String(Date.now()))

  const url = `${base}${pathname}?${query.toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.cookie ? { Cookie: options.cookie } : {})
      },
      signal: controller.signal
    })

    const text = await response.text()
    if (!response.ok) {
      throw new KugouHttpError(
        `酷狗接口 ${pathname} 返回 ${response.status}${text ? `：${text.slice(0, 160)}` : ''}`,
        response.status
      )
    }

    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      throw new KugouHttpError(`酷狗接口 ${pathname} 返回的不是 JSON`, response.status)
    }

    const setCookie =
      typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
    return { body, setCookie }
  } finally {
    clearTimeout(timer)
  }
}

// --- 一个曲目行的读取 ----------------------------------------------------

/**
 * 把上游的一个曲目行读成共享形状。
 *
 * **实测的两个来源、两套字段**：
 *   * `/search/song` -> `data.lists[]`：`SongName`/`SingerName`/`SingerId`/
 *     `AlbumName`/`AlbumID`/`FileHash`/`HQFileHash`/`SQFileHash`/`Duration`(秒)/
 *     `Image`/`MixSongID`/`Audioid`。
 *   * `/playlist/track/all` -> `data.songs[]`：`hash`/`audio_id`/`mixsongid`/
 *     `album_id`/`name`（**「歌手 - 歌名」合体**）/`timelen`(毫秒)/
 *     `cover`/`albuminfo`/`singerinfo`/`relate_goods`（多音质 hash 表）。
 *
 * 两个来源都认，缺的字段留空，不编。
 */
function readSongRow(value: unknown): KugouSong | null {
  const row = asRecord(value)
  const name = asString(row.SongName) || asString(row.songname) || asString(row.name)
  if (!name) return null

  const singers = asArray(row.singerinfo).map(asRecord)
  // 新歌速递（/top/song）不走 singerinfo，而是 authors[]：
  // { author_id, author_name, sizable_avatar }。
  const authors = asArray(row.authors).map(asRecord)
  const singerIds = asArray(row.SingerId)

  const artists = singers.length
    ? singers.map((singer, index) => ({
        id: numberOr(singer.id, numberAt(singerIds, index)),
        name: asString(singer.name) || '未知歌手',
        avatar: sizedImage(asString(singer.avatar) || null, 240)
      }))
    : authors.length
      ? authors.map((author) => ({
          id: numberOr(author.author_id, 0),
          name: asString(author.author_name) || '未知歌手',
          avatar: sizedImage(asString(author.sizable_avatar) || null, 240)
        }))
      : splitSingers(
          asString(row.SingerName) || asString(row.singername),
          singerIds.length ? singerIds : asArray(row.singerid)
        )

  // 「歌手 - 歌名」：只拆第一段，歌手名里本来就可能带「-」。
  const combined = name.split(' - ')
  const title = combined.length > 1 && artists.length === 0 ? combined.slice(1).join(' - ') : name
  const fallbackArtist = combined.length > 1 && artists.length === 0 ? combined[0].trim() : ''

  if (artists.length === 0 && fallbackArtist) {
    artists.push({ id: 0, name: fallbackArtist, avatar: null })
  }

  const goods = asArray(row.relate_goods).map(asRecord)
  const goodHash = (bitrate: number): string => {
    const match = goods.find((good) => numberOr(good.bitrate, 0) === bitrate)
    return match ? asString(match.hash) : ''
  }

  const hash = asString(row.FileHash) || asString(row.hash)
  if (!hash) return null

  const albumInfo = asRecord(row.albuminfo)
  const durationMsOrSec = numberOr(
    row.Duration,
    numberOr(row.timelength, numberOr(row.timelen, numberOr(row.time_length, 0)))
  )
  // 搜索给秒（269），歌单给毫秒（228911）。大于 3600 只可能是毫秒。
  const duration = durationMsOrSec > 3600 ? Math.round(durationMsOrSec / 1000) : durationMsOrSec

  const id = numberOr(
    row.Audioid,
    numberOr(
      row.audio_id,
      numberOr(row.mixsongid, numberOr(row.MixSongID, numberOr(row.songid, 0)))
    )
  )

  const privilege = numberOr(row.Privilege, numberOr(row.privilege, 0))
  const payType = numberOr(row.PayType, numberOr(row.pay_type, 0))
  // 位语义没有可信文档，只把「确实有付费标记」当提示；不能确定的一律 0。
  const paidHint = payType > 0 || privilege >= 8 ? 1 : 0

  return {
    id,
    songId: id,
    hash,
    hqHash: asString(row.HQFileHash) || asString(row.hash_320) || goodHash(320),
    sqHash:
      asString(row.SQFileHash) ||
      asString(row.hash_flac) ||
      asString(row.hash_ape) ||
      goodHash(1102) ||
      goodHash(999),
    albumAudioId: String(row.MixSongID ?? row.mixsongid ?? row.album_audio_id ?? ''),
    albumId: String(row.AlbumID ?? row.album_id ?? albumInfo.id ?? ''),
    name: title,
    artists,
    album: {
      id: String(row.AlbumID ?? row.album_id ?? albumInfo.id ?? ''),
      name: asString(row.AlbumName) || asString(row.album_name) || asString(albumInfo.name),
      picUrl: sizedImage(
        asString(row.Image) ||
          asString(row.cover) ||
          asString(row.album_sizable_cover) ||
          asString(row.album_cover) ||
          asString(row.album_image) ||
        asString(row.sizable_cover) ||
          asString(asRecord(row.trans_param).union_cover) ||
          null,
        480
      )
    },
    duration,
    fee: paidHint,
    paid: paidHint === 1
  }
}

function splitSingers(name: string, ids: unknown[]): KugouSong['artists'] {
  const names = name
    .split(/[、,&/]/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (names.length === 0) return []
  return names.map((part, index) => ({
    id: numberOr(ids[index], 0),
    name: part,
    avatar: null
  }))
}

// --- 搜索结果 -----------------------------------------------------------

/** `/search/song` 实测：`{status:1,error_code:0,data:{lists:[...],total}}`。 */
export function readSearchSongs(raw: unknown): KugouSong[] {
  const data = asRecord(asRecord(raw).data)
  return readSongRows(data.lists)
}

function readSongRows(value: unknown): KugouSong[] {
  return asArray(value)
    .map(readSongRow)
    .filter((song): song is KugouSong => song !== null)
}

/** 新歌速递（/top/song）实测：{ total, error_code: 0, data: [...] }。 */
export function readNewSongs(raw: unknown): KugouSong[] {
  return readSongRows(asRecord(raw).data)
}

// --- 歌单 ---------------------------------------------------------------

/**
 * `/top/playlist` 实测：`{data:{special_list:[...]}}`，每项 `specialname`、
 * `imgurl`/`flexible_cover`（含 `{size}`）、`global_collection_id`、`percount`、
 * `nickname`。这是未登录时能读到的公开榜单。
 */
export function readTopPlaylists(raw: unknown): RawPlaylist[] {
  const data = asRecord(asRecord(raw).data)
  return asArray(data.special_list).map(asRecord).flatMap((row) => {
    const globalId = asString(row.global_collection_id) || asString(row.specialid)
    const name = asString(row.specialname) || asString(row.name)
    if (!globalId || !name) return []
    return [
      {
        globalId,
        name,
        coverUrl: sizedImage(asString(row.imgurl) || asString(row.flexible_cover) || null, 300),
        trackCount: numberOr(row.percount, numberOr(row.song_count, 0)),
        creator: asString(row.nickname)
      }
    ]
  })
}

/**
 * `/user/playlist` 的形状**未实测**（匿名 502，登录后才给）。
 *
 * 因此这里扫所有已知候选数组名（`data.info` 是 KuGou `/v7/get_all_list` 的常见
 * 形状），字段名同样多路兜底。等真人扫码后看 startup.log 里写下的原始 key 列表
 * 再收口成唯一路径。
 */
export function readUserPlaylists(raw: unknown): RawPlaylist[] {
  const root = asRecord(raw)
  const data = asRecord(root.data)
  const candidates = [data.info, data.list, data.lists, data.playlists, root.info]
  const rows = candidates.find((value) => Array.isArray(value) && value.length > 0)
  if (!rows) return []

  return asArray(rows).map(asRecord).flatMap((row) => {
    const globalId =
      asString(row.global_collection_id) ||
      asString(row.gid) ||
      asString(row.listid) ||
      asString(row.specialid)
    const name = asString(row.listname) || asString(row.name) || asString(row.specialname)
    if (!globalId || !name) return []
    return [
      {
        globalId,
        name,
        coverUrl: sizedImage(asString(row.imgurl) || asString(row.pic) || asString(row.cover) || null, 300),
        trackCount: numberOr(row.song_count, numberOr(row.count, numberOr(row.songcount, 0))),
        creator: asString(row.nickname) || asString(row.list_create_username)
      }
    ]
  })
}

interface RawPlaylist {
  /** 上游歌单身份（字符串），主进程给它配数字别名。 */
  globalId: string
  name: string
  coverUrl: string | null
  trackCount: number
  creator: string
}

// --- 「我喜欢」这一张歌单 -----------------------------------------------

/**
 * 酷狗没有「喜欢一首歌」的独立接口：喜欢就是**把歌加进「我喜欢」那张云端歌单**，
 * 取消就是删掉。所以写喜欢之前先得认出这张歌单。
 *
 * 一张歌单有两个 id，混用会 100% 失败：
 *   * `global_collection_id`（`collection_3_${uid}_0_${listid}_0`）——读曲目用；
 *   * `list_create_listid`（纯数字）——加歌、删歌用。
 *
 * 名字优先认「我喜欢」，认不到再退到 `is_default`，最后从 `global_collection_id`
 * 里拆数字；全都认不出就返回空串，让上层报「没有找到我喜欢」而不是瞎写。
 */
export function readFavoriteList(raw: unknown): { listId: string; globalId: string } {
  const root = asRecord(raw)
  const data = asRecord(root.data)
  const rows = asArray(
    [data.info, data.list, data.lists, data.playlists, root.info].find(
      (value) => Array.isArray(value) && value.length > 0
    )
  ).map(asRecord)

  if (rows.length === 0) return { listId: '', globalId: '' }
  const nameOf = (row: Record<string, unknown>): string =>
    asString(row.listname) || asString(row.name) || asString(row.specialname)

  const favorite =
    rows.find((row) => nameOf(row).includes('我喜欢')) ??
    rows.find((row) => Number(row.is_default) === 1 || Number(row.default) === 1)
  if (!favorite) return { listId: '', globalId: '' }

  const globalId = asString(favorite.global_collection_id)
  const direct =
    asString(favorite.list_create_listid) || asString(favorite.listid) || asString(favorite.list_id)
  if (direct) return { listId: direct, globalId }

  // `collection_3_${uid}_0_${listid}_0`：第三段才是 listid。
  const matched = globalId.match(/^collection_\d+_\d+_\d+_(\d+)_\d+$/)
  return { listId: matched ? matched[1] : '', globalId }
}

/** 歌单曲目的原始行（写「取消喜欢」要 `fileid`，共享形状里没有这个字段）。 */
export function readPlaylistRawSongs(raw: unknown): Record<string, unknown>[] {
  const data = asRecord(asRecord(raw).data)
  return asArray(data.songs).map(asRecord)
}

/**
 * 写接口的成功判定。
 *
 * 酷狗网关对写请求的应答是 `{error_code, status, ...}`，`status` 为 1 或
 * `error_code` 为 0 才算成；两者都没有就当作没成——宁可让上层报失败，也不把
 * 「不知道」说成「已保存」。
 */
export function readWriteOk(raw: unknown): boolean {
  const root = asRecord(raw)
  const code = Number(root.error_code ?? root.err_code ?? root.errcode)
  const status = Number(root.status)
  if (Number.isFinite(code) && code === 0) return true
  if (Number.isFinite(status) && status === 1) return true
  return false
}

/**
 * `/playlist/track/all` 实测：`{error_code:0,data:{count,list_info,songs:[...]}}`。
 */
export function readPlaylistTracks(raw: unknown): KugouSong[] {
  const data = asRecord(asRecord(raw).data)
  return readSongRows(data.songs)
}

// --- 取流 ---------------------------------------------------------------

/**
 * 从 `/song/url` 的响应里找播放地址。
 *
 * **成功形状未实测**：匿名请求一律被 `20028` 拦下，所以真实的成功 body 还没见过。
 * 因此这里先走 v5/url 的常规路径（`data.url`，可能是字符串或数组），再做一次
 * 有深度上限的扫，只认 http(s) 且带音频后缀的字符串——避免把封面图当音频。
 * 这是**待收口**的读取器，不是猜出来的唯一路径。
 */
export function readSongUrl(raw: unknown): string {
  const direct = firstUrl(asRecord(asRecord(raw).data).url)
  if (direct) return direct
  const second = firstUrl(asRecord(raw).url)
  if (second) return second
  const scanned = deepAudioUrl(raw, 0)
  return scanned
}

function firstUrl(value: unknown): string {
  if (typeof value === 'string' && isAudioUrl(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstUrl(item)
      if (found) return found
    }
    return ''
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return firstUrl(record.url) || firstUrl(record.play_url) || ''
  }
  return ''
}

const AUDIO_PATTERN = /\.(mp3|flac|m4a|aac|ogg|wav|ape|wma)(\?|$)/i

function isAudioUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) && AUDIO_PATTERN.test(value)
}

function deepAudioUrl(value: unknown, depth: number): string {
  if (depth > 4 || !value || typeof value !== 'object') return ''
  for (const item of Object.values(value as Record<string, unknown>)) {
    if (typeof item === 'string' && isAudioUrl(item)) return item
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = deepAudioUrl(item, depth + 1)
    if (found) return found
  }
  return ''
}

/** 上游的拒绝信息：`errcode`/`status`/`error`，喂给 `reasons.ts`。 */
export function readUpstreamFailure(raw: unknown): {
  errcode: number | null
  status: number | null
  message: string
} {
  const root = asRecord(raw)
  const data = asRecord(root.data)
  return {
    errcode: maybeNumber(root.errcode) ?? maybeNumber(root.err_code) ?? maybeNumber(data.errcode),
    status: maybeNumber(root.status) ?? maybeNumber(data.status),
    message: asString(root.error) || asString(root.message) || asString(data.error)
  }
}

// --- 扫码登录 -----------------------------------------------------------

/**
 * `/login/qr/key` 实测：`{status:1,data:{qrcode:'b81c...', qrcode_img:'data:image/png;base64,...'}}`。
 * `qrcode` 是**轮询钥匙**（不是 hash），`qrcode_img` 已经是完整 data URL。
 */
export function readQrKey(raw: unknown): string {
  return asString(asRecord(asRecord(raw).data).qrcode)
}

/** `/login/qr/create` 实测：`{code:200,data:{url,base64:'data:image/png;base64,...'}}`。 */
export function readQrImage(raw: unknown): string {
  const data = asRecord(asRecord(raw).data)
  return asString(data.base64) || asString(data.qrcode_img) || asString(data.url)
}

/**
 * `/login/qr/check` 实测：`{data:{status:1},status:1,error_code:0}`。
 *
 * 语义（vendor `login_qr_check.js`）：0 过期 / 1 等待 / 2 待确认 / 4 成功。
 * 成功时 token 与 userid 同时在 body 和 Set-Cookie 里。
 */
export function readQrCheck(raw: unknown): {
  status: number
  token: string
  userid: string
  message: string
} {
  const root = asRecord(raw)
  const data = asRecord(root.data)
  const status = numberOr(data.status, numberOr(root.status, 1))
  return {
    status,
    token: asString(data.token) || cookieValue(root, 'token'),
    userid: String(data.userid ?? '') || cookieValue(root, 'userid'),
    message: asString(data.message) || asString(root.message) || asString(root.error)
  }
}

/** 从 Set-Cookie 行里挑出 `token`/`userid`（扫码成功时的真实来源之一）。 */
export function sessionFromCookies(setCookie: string[]): { token: string; userid: string } {
  let token = ''
  let userid = ''
  for (const line of setCookie) {
    const name = line.split('=')[0]?.trim().toLowerCase() ?? ''
    const value = line.slice(line.indexOf('=') + 1).split(';')[0]?.trim() ?? ''
    if (name === 'token' && value) token = value
    if (name === 'userid' && value) userid = value
  }
  return { token, userid }
}

/** 组装请求用的 Cookie 头。 */
export function cookieHeader(state: { token: string; userid: string }): string {
  const parts: string[] = []
  if (state.token) parts.push(`token=${state.token}`)
  if (state.userid) parts.push(`userid=${state.userid}`)
  return parts.join('; ')
}

// --- 账号 ---------------------------------------------------------------

/**
 * `/user/detail` 的形状**未实测**（需要登录）。
 *
 * 多路兜底读昵称与头像：`data.nickname`/`nick_name`/`user_name`、`data.pic`/
 * `picture`/`avatar`/`user_pic`，并允许再嵌一层 `data.data`。取不到就退回
 * 「酷狗用户{userid}」/null，不编造。
 */
export function readAccount(raw: unknown, userid: string): {
  id: number
  nickname: string
  avatarUrl: string | null
} {
  const root = asRecord(raw)
  const outer = asRecord(root.data)
  const data = Object.keys(outer).length ? outer : root
  const inner = asRecord(data.data)
  const merged = Object.keys(inner).length ? { ...data, ...inner } : data

  const nickname =
    asString(merged.nickname) ||
    asString(merged.nick_name) ||
    asString(merged.user_name) ||
    asString(merged.username) ||
    asString(merged.nick)

  const avatarRaw =
    asString(merged.pic) ||
    asString(merged.picture) ||
    asString(merged.avatar) ||
    asString(merged.user_pic) ||
    asString(merged.img)

  const id = Number(userid) || numberOr(merged.userid, numberOr(merged.user_id, 0))
  return {
    id,
    nickname: nickname || (id ? `酷狗用户${id}` : '酷狗用户'),
    avatarUrl: sizedImage(avatarRaw || null, 240)
  }
}

// --- 其它小工具 ---------------------------------------------------------

/** 把 `{size}` 占位符换成实际像素，并把 http 升到 https（页面走 aurora-remote 取图）。 */
export function sizedImage(url: string | null, size: number): string | null {
  if (!url) return null
  const filled = url.replace(/\{size\}/g, String(size))
  return filled.startsWith('http://') ? `https://${filled.slice('http://'.length)}` : filled
}

function cookieValue(raw: Record<string, unknown>, name: string): string {
  const cookie = raw.cookie
  if (Array.isArray(cookie)) {
    for (const line of cookie) {
      if (typeof line !== 'string') continue
      const [key, ...rest] = line.split('=')
      if (key?.trim() === name) return rest.join('=').split(';')[0]?.trim() ?? ''
    }
  }
  return ''
}

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

/** 数字或数字字符串 -> number；别的形状一律给 fallback。 */
function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

/** 同一个读法，但「没报」和「报了 0」要分开时用它。 */
function maybeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function numberAt(values: unknown[], index: number): number {
  return numberOr(values[index], 0)
}

// --- 专辑与艺人 ---------------------------------------------------------

/**
 * 一个曲目行的时间：有的接口给秒，有的给毫秒。
 *
 * 与 `readSongRow` 里同一条经验：大于 3600 只可能是毫秒。
 */
function secondsFrom(value: number): number {
  return value > 3600 ? Math.round(value / 1000) : value
}

function yearOf(value: string): number | null {
  const match = /^(\d{4})/.exec(value)
  return match ? Number(match[1]) : null
}

/**
 * `/album/songs` 的一行。
 *
 * **结构与自己以为的不一样**：它不是 `/playlist/track/all` 那种扁平行，而是
 * 分成 `base`（歌名、audio_id、album_audio_id）、`audio_info`（三档 hash 与
 * 时长）、`album_info`（专辑名与封面）、`authors`（歌手 id 与名字）四块。
 * 用扁平读取器读它只会得到 null，所以单写一个。
 */
function readAlbumSongRow(value: unknown): KugouSong | null {
  const row = asRecord(value)
  const base = asRecord(row.base)
  const audio = asRecord(row.audio_info)
  const name = asString(base.audio_name)
  const hash = asString(audio.hash) || asString(audio.hash_128)
  if (!name || !hash) return null

  const albumInfo = asRecord(row.album_info)
  const albumId = String(base.album_id ?? '')
  const authors = asArray(row.authors).map(asRecord)
  const artists = authors
    .map((author) => ({
      id: numberOr(author.author_id, 0),
      name: asString(author.author_name),
      avatar: null
    }))
    .filter((artist) => artist.name)
  const payType = numberOr(asRecord(row.deprecated).pay_type, 0)

  return {
    id: numberOr(base.audio_id, 0),
    songId: numberOr(base.audio_id, 0),
    hash,
    hqHash: asString(audio.hash_320),
    sqHash: asString(audio.hash_flac),
    albumAudioId: String(base.album_audio_id ?? ''),
    albumId,
    name,
    artists,
    album: {
      id: albumId,
      name: asString(albumInfo.album_name),
      picUrl: sizedImage(
        asString(albumInfo.cover) || asString(asRecord(row.trans_param).union_cover) || null,
        480
      )
    },
    duration: secondsFrom(numberOr(audio.duration, 0)),
    fee: payType > 0 ? 1 : 0,
    paid: payType > 0
  }
}

/** `/album/songs` 实测：`{total, data:{total, songs:[...]}}`。 */
export function readAlbumSongs(raw: unknown): KugouSong[] {
  const data = asRecord(asRecord(raw).data)
  return asArray(data.songs)
    .map(readAlbumSongRow)
    .filter((song): song is KugouSong => song !== null)
}

/** `/album/songs` 的 total：曲目数只有这里报。 */
export function readAlbumSongCount(raw: unknown): number {
  const data = asRecord(asRecord(raw).data)
  return numberOr(data.total, numberOr(asRecord(raw).total, 0))
}

/**
 * `/album/detail` 实测：`{status:1, data:[{album_id, album_name, sizable_cover,
 * cover, intro, publish_date, author_name, ...}]}`。
 *
 * 注意 `data` 是**数组**，而且封面是带 `{size}` 占位的模板地址，要过
 * `sizedImage` 才是一张能取的图。
 */
export function readAlbumDetail(raw: unknown): KugouAlbumDetail | null {
  const row = asRecord(asArray(asRecord(raw).data)[0])
  const id = numberOr(row.album_id, 0)
  const name = asString(row.album_name)
  if (!id || !name) return null

  const authors = asArray(row.authors)
    .map(asRecord)
    .map((author) => asString(author.author_name))
    .filter(Boolean)

  return {
    id,
    name,
    artist: asString(row.author_name) || authors.join(' / '),
    picUrl: sizedImage(
      asString(row.sizable_cover) || asString(row.cover) || null,
      480
    ),
    year: yearOf(asString(row.publish_date)),
    intro: asString(row.intro),
    songCount: 0
  }
}

/**
 * `/artist/audios` 的一行。
 *
 * 这一家是**扁平行**（`hash`/`hash_320`/`audio_name`/`author_name`），但歌手
 * 只有一个名字、没有 id——这一页本来就是同一个艺人，不需要再点回他；多歌手
 * 的情况按分隔符拆名字，id 留 0，界面会渲染成纯文字。
 */
function readArtistAudioRow(value: unknown): KugouSong | null {
  const row = asRecord(value)
  const name = asString(row.audio_name)
  const hash = asString(row.hash) || asString(row.hash_128)
  if (!name || !hash) return null

  const albumId = String(row.album_id ?? '')
  const payType = numberOr(row.pay_type, 0)

  return {
    id: numberOr(row.audio_id, 0),
    songId: numberOr(row.audio_id, 0),
    hash,
    hqHash: asString(row.hash_320),
    sqHash: asString(row.hash_flac),
    albumAudioId: String(row.album_audio_id ?? ''),
    albumId,
    name,
    artists: splitSingers(asString(row.author_name), []),
    album: {
      id: albumId,
      name: asString(row.album_name),
      picUrl: sizedImage(asString(asRecord(row.trans_param).union_cover) || null, 480)
    },
    duration: secondsFrom(numberOr(row.timelength, 0)),
    fee: payType > 0 ? 1 : 0,
    paid: payType > 0
  }
}

export function readArtistAudios(raw: unknown): KugouSong[] {
  return asArray(asRecord(raw).data)
    .map(readArtistAudioRow)
    .filter((song): song is KugouSong => song !== null)
}

/** `/artist/detail` 实测：`{data:{author_id, author_name, sizable_avatar, album_count,
 * song_count, fansnums, long_intro:[{title, content}]}}`。 */
export function readArtistDetail(raw: unknown): KugouArtistDetail | null {
  const data = asRecord(asRecord(raw).data)
  const id = numberOr(data.author_id, 0)
  const name = asString(data.author_name)
  if (!id || !name) return null

  const firstIntro = asRecord(asArray(data.long_intro)[0])
  return {
    id,
    name,
    picUrl: sizedImage(asString(data.sizable_avatar) || null, 480),
    albumCount: numberOr(data.album_count, 0),
    songCount: numberOr(data.song_count, 0),
    fans: numberOr(data.fansnums, 0),
    intro: asString(firstIntro.content) || asString(data.intro)
  }
}

/** `/artist/albums` 实测：`{total, data:[{album_id, album_name, sizable_cover,
 * publish_date, authors:[{author_id, author_name}], ...}]}`。 */
export function readArtistAlbums(raw: unknown): KugouAlbumEntry[] {
  return asArray(asRecord(raw).data)
    .map(asRecord)
    .map((row) => {
      const id = numberOr(row.album_id, 0)
      const name = asString(row.album_name)
      if (!id || !name) return null
      const authors = asArray(row.authors)
        .map(asRecord)
        .map((author) => asString(author.author_name))
        .filter(Boolean)
      return {
        id,
        name,
        artist: asString(row.author_name) || authors.join(' / '),
        picUrl: sizedImage(
          asString(row.sizable_cover) || asString(row.cover) || null,
          360
        ),
        year: yearOf(asString(row.publish_date)),
        songCount: 0
      }
    })
    .filter((album): album is KugouAlbumEntry => album !== null)
}

/**
 * `/recommend/songs` 实测：`{status:1, data:{creation_date, song_list:[...]}}`。
 *
 * 30 首，**游客也给**——这是酷狗唯一不用扫码就能拿到的「今天该听什么」。行结构与搜索/
 * 歌单那套不同：没有 `relate_goods`，音质 hash 平铺成 `hash_320`/`hash_flac`，时长叫
 * `time_length`，封面叫 `sizable_cover`。这些都已在 `readSongRow` 里兼容。
 */
export function readDailySongs(raw: unknown): KugouSong[] {
  const data = asRecord(asRecord(raw).data)
  return asArray(data.song_list)
    .map(readSongRow)
    .filter((song): song is KugouSong => song !== null)
}

