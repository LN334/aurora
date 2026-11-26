import { ipcMain } from 'electron'
import { write } from '../startup-log'
import { whenWindowVisible } from '../window-visible'
import { loadSettings, saveSettings } from '../settings'
import * as client from './client'
import { describeFailure } from './reasons'
import { registerProviderCapability } from '../provider-gateway.ts'
import { namedArgument } from '../pure/provider-call.ts'
import { isNeteaseQuality, isUsableId } from './types'
import type { CommentPage, CommentWriteResult } from '../comments'
import type {
  NeteaseAccount,
  NeteaseAlbum,
  NeteaseAlbumSummary,
  NeteaseArtistDetail,
  NeteaseCollectedAlbum,
  NeteaseFollowedArtist,
  NeteaseDiscoverKind,
  NeteaseDiscoverResult,
  NeteaseLoginResult,
  NeteasePlaylistSummary,
  NeteaseQrResult,
  NeteaseQrSession,
  NeteaseQuality,
  NeteaseSearchResult,
  NeteaseSong,
  NeteaseStatusResult,
  NeteaseStreamResult
} from './types'

/**
 * The `netease:*` channels, and the place renderer input stops being trusted.
 *
 * Everything here arrives as `unknown` from the page, so each argument is
 * checked for the shape the channel needs before it reaches the client. That is
 * not paranoia about the user: the renderer runs third-party song metadata and
 * cover images, and a wrong type that reaches the upstream package turns into a
 * confusing network error far from its cause.
 *
 * No channel rejects. A rejected `invoke` arrives in page code as an unhandled
 * rejection in the middle of a render, which for a player means a blank view
 * with no explanation; an empty result plus `netease:status` is the honest,
 * survivable failure.
 */

const MAX_KEYWORDS = 100
const MAX_IDS = 1000
const MAX_DISCOVER_LIMIT = 60
const SEARCH_TYPES = ['song', 'album', 'artist'] as const
type SearchType = (typeof SEARCH_TYPES)[number]
const DISCOVER_KINDS = ['newsongs', 'playlists', 'quality'] as const

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * Song, album, artist and playlist ids are all positive integers upstream.
 * `isUsableId` already rejects anything past the safe integer range, so this
 * only has to narrow `unknown` before handing the value over.
 */
function asId(value: unknown): number | null {
  return typeof value === 'number' && isUsableId(value) ? value : null
}

/** limit / offset：非要紧的正整数就用 fallback（offset 的 fallback 是 0），上限收紧。 */
function asCount(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.trunc(value), max)
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function asQuality(value: unknown): NeteaseQuality | null {
  return isNeteaseQuality(value) ? value : null
}

function asSearchType(value: unknown): SearchType {
  return typeof value === 'string' && (SEARCH_TYPES as readonly string[]).includes(value)
    ? (value as SearchType)
    : 'song'
}

/**
 * A discover block name, or null.
 *
 * Strict on purpose: the renderer only ever sends one of three literals, so
 * anything else is a bug or a stale build. Guessing a block would mean showing
 * the wrong catalogue under the right tab.
 */
function asDiscoverKind(value: unknown): NeteaseDiscoverKind | null {
  return typeof value === 'string' && (DISCOVER_KINDS as readonly string[]).includes(value)
    ? (value as NeteaseDiscoverKind)
    : null
}

function asDiscoverLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(MAX_DISCOVER_LIMIT, Math.max(1, Math.trunc(value)))
}

/**
 * 换一批的游标：已经看过多少条。
 *
 * 上限挡住一个坏渲染层把 offset 撑到天上去（上游会把大 offset 当空结果）。
 * 24 条一批，2000 够翻八十多次，远超一个人在一页上会点的次数。
 */
const MAX_DISCOVER_OFFSET = 2000

/**
 * 一条评论最多认多少字。
 *
 * 这里只做防爆截断（500 远大于平台上限 140），真正的字数限制在 client 里——
 * 在 IPC 层截到 140 会把用户的输入悄悄剪掉，然后发出去还是成功，很奇怪。
 */
const MAX_COMMENT_TEXT = 500

function asDiscoverOffset(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(MAX_DISCOVER_OFFSET, Math.max(0, Math.trunc(value)))
}

function asIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const ids = value.map(asId).filter((id): id is number => id !== null)
  return Array.from(new Set(ids)).slice(0, MAX_IDS)
}

const currentQuality = (): NeteaseQuality => {
  // settings.json is a file the user can edit, so a value that is not one of
  // the four levels is possible; upstream would answer such a request with a
  // generic error rather than a useful one.
  const stored = loadSettings().neteaseQuality
  return isNeteaseQuality(stored) ? stored : 'exhigh'
}

/** The shared "something went wrong" answer for a stream that never resolved. */
const unknownStream = (): NeteaseStreamResult => ({
  ok: false,
  reason: 'unknown',
  message: describeFailure('unknown')
})

async function guard<T>(
  label: string,
  fallback: T,
  run: () => Promise<T>,
  /*
   * 失败时把错误抛回去，而不是交一个空结果。
   *
   * 只有「读我喜欢的」这类通道要它：那里空列表与没读到是两件事，而 `guard`
   * 把失败压成 `[]`，渲染层就永远分不出这两者——2026-11-26 冷启动看到的就是
   * 上游一次抖动被画成「还没有喜欢的歌」。其余通道照旧吞掉，页面各自有话说。
   */
  strict = false
): Promise<T> {
  /*
   * 上游包第一次 require 要一秒多，而它是同步的：主进程的事件循环被占住时，
   * 渲染进程画完的首帧也只能排在后面，窗口跟着一起晚出现（见 window-visible.ts）。
   * 等窗口露过脸再动手，这几百毫秒就落在页面里，不再是「点了图标愣两秒」。
   */
  await whenWindowVisible()
  try {
    const value = await run()
    // 成功路径也记（只记失败看不出是哪一步返回了空结果）。label 不含参数，避免密码进日志。
    write(`netease:${label} ok`)
    return value
  } catch (error) {
    // 上游用普通对象 reject，String() 会得到 "[object Object]"（日志里就是这么丢掉原因的）。
    const detail = (value: unknown): string => {
      if (value instanceof Error) return value.message
      if (value && typeof value === 'object') {
        const record = value as { body?: unknown; status?: unknown; message?: unknown }
        const body = record.body as { msg?: unknown; message?: unknown; code?: unknown } | undefined
        const msg = body?.msg ?? body?.message ?? record.message
        if (typeof msg === 'string' && msg) return `${msg}${body?.code !== undefined ? ` (code ${String(body.code)})` : ''}${record.status !== undefined ? ` [http ${String(record.status)}]` : ''}`
        try {
          return JSON.stringify(value).slice(0, 200)
        } catch {
          return '[unserialisable error]'
        }
      }
      return String(value)
    }
    const message = detail(error)
    write(`netease:${label} FAILED ${message}`)
    console.error(`[aurora] netease:${label} failed`, message)
    if (strict) throw error
    return fallback
  }
}

/**
 * 搜索：旧通道与新的 `provider:call` 共用这一份实现。
 *
 * 搬家期间两条入口必须给出同一个答案，否则「切过去还坏着」的地方就看不出来。
 */
function searchNetease(args: unknown): Promise<NeteaseSearchResult> {
  const record = asRecord(args)
  const keywords = asText(record.keywords, MAX_KEYWORDS)
  const type = asSearchType(record.type)
  const limit = typeof record.limit === 'number' ? record.limit : 30
  const empty: NeteaseSearchResult = { songs: [], albums: [], artists: [] }
  if (!keywords) return Promise.resolve(empty)
  return guard('search', empty, () => client.neteaseSearch(keywords, type, limit))
}

/** 歌词：旧通道 `netease:lyrics` 与 `provider:call` 共用这一份实现（理由同搜索）。 */
function lyricsNetease(args: unknown) {
  const songId = asId(namedArgument(args, 'songId'))
  if (songId === null) return null
  return guard('lyrics', null, () => client.neteaseLyrics(songId))
}

/*
 * 账号这一组。
 *
 * 七个动作各一份实现，旧通道与 `provider:call` 都调它：不是两套逻辑，是两个
 * 门。失败语义照旧—— `guard` 折回兜底值，界面继续看到「未登录」而不是「坏
 * 了」。后者在 IPC 之外几乎无法区分，这是既有的取舍，不在这一支改。
 */
const statusFailure: NeteaseStatusResult = { ready: false, loggedIn: false }

function statusNetease(): Promise<NeteaseStatusResult> {
  return guard('status', statusFailure, () => client.neteaseStatus())
}

/** The profiles screen asks about profiles that are not active. */
function accountForNetease(args: unknown): Promise<NeteaseAccount | null> {
  const profileId = asText(namedArgument(args, 'profileId'), 64) ?? ''
  return guard<NeteaseAccount | null>('accountFor', null, () =>
    client.neteaseAccountFor(profileId)
  )
}

function logoutProfileNetease(args: unknown): Promise<boolean> | boolean {
  const profileId = asText(namedArgument(args, 'profileId'), 64)
  if (!profileId) return false
  return client.neteaseLogoutProfile(profileId)
}

function qrCreateNetease(): Promise<NeteaseQrSession> {
  const empty: NeteaseQrSession = { key: '', url: '', imageDataUrl: '' }
  return guard('qrCreate', empty, () => client.neteaseQrCreate())
}

function qrCheckNetease(args: unknown): Promise<NeteaseQrResult> {
  const key = asText(namedArgument(args, 'key'), 128)
  if (!key) return Promise.resolve({ status: 'failed', message: '二维码已失效，请重新获取' })
  const failed: NeteaseQrResult = { status: 'failed', message: '登录状态查询失败，请重试' }
  return guard('qrCheck', failed, () => client.neteaseQrCheck(key))
}

function loginCellphoneNetease(args: unknown): Promise<NeteaseLoginResult> {
  const record = asRecord(args)
  const phone = typeof record.phone === 'string' ? record.phone.trim() : ''
  const password = typeof record.password === 'string' ? record.password : ''
  // Length only: the values themselves never reach a log or an error message.
  if (!/^\d{5,20}$/.test(phone) || password.length < 1 || password.length > 128) {
    return Promise.resolve({ ok: false, message: '手机号或密码格式不正确' })
  }
  const failed: NeteaseLoginResult = { ok: false, message: '登录失败，请重试' }
  return guard('loginCellphone', failed, () => client.neteaseLoginCellphone(phone, password))
}

function loginStatusNetease(): Promise<NeteaseAccount | null> {
  return guard<NeteaseAccount | null>('loginStatus', null, () => client.neteaseLoginStatus())
}

function logoutNetease(): Promise<boolean> {
  return guard('logout', false, () => client.neteaseLogout())
}

function myPlaylistsNetease(): Promise<NeteasePlaylistSummary[]> {
  return guard<NeteasePlaylistSummary[]>('myPlaylists', [], () => client.neteaseMyPlaylists())
}

function playlistTracksNetease(args: unknown): Promise<NeteaseSong[]> {
  const id = asId(namedArgument(args, 'playlistId'))
  if (id === null) return Promise.resolve([])
  return guard<NeteaseSong[]>('playlistTracks', [], () => client.neteasePlaylistTracks(id))
}

function playlistCreatorNetease(args: unknown): Promise<string> {
  const id = asId(namedArgument(args, 'playlistId'))
  if (id === null) return Promise.resolve('')
  return guard<string>('playlistCreator', '', () => client.neteasePlaylistCreator(id))
}

/*
 * 喜欢：读整张表（liked）与写一条（like）。
 *
 * 读这一支照旧 strict——空数组与没读到是两件事，收藏页靠这个错误把「没读到」
 * 记进 failed，三十秒后再问一次（见 liked-merge）。写失败只回 false，界面照实提示。
 */
function likedNetease(): Promise<NeteaseSong[]> {
  return guard<NeteaseSong[]>('likeList', [], () => client.neteaseLikeList(), true)
}

function likeNetease(args: unknown): Promise<boolean> {
  const record = asRecord(args)
  const id = asId(record.songId)
  if (id === null) return Promise.resolve(false)
  return guard<boolean>('like', false, () => client.neteaseLike(id, record.liked === true))
}

/*
 * 专辑页与艺人页：一张专辑、一位艺人的资料、热门曲目、全部歌曲、专辑列表。
 *
 * 这一批只搬家——失败仍折回 null / 空数组，与旧通道逐字段一致。页面对空结果
 * 各有各的说法，改语义要把三条页面一起改，留作单独一版。
 */
function albumNetease(args: unknown): Promise<NeteaseAlbum | null> {
  const id = asId(namedArgument(args, 'albumId'))
  if (id === null) return Promise.resolve(null)
  return guard<NeteaseAlbum | null>('album', null, () => client.neteaseAlbum(id))
}

function artistDetailNetease(args: unknown): Promise<NeteaseArtistDetail | null> {
  const id = asId(namedArgument(args, 'artistId'))
  if (id === null) return Promise.resolve(null)
  return guard<NeteaseArtistDetail | null>('artistDetail', null, () => client.neteaseArtistDetail(id))
}

function artistTopSongsNetease(args: unknown): Promise<NeteaseSong[]> {
  const id = asId(namedArgument(args, 'artistId'))
  const limit = asCount(namedArgument(args, 'limit'), 50, 200)
  if (id === null) return Promise.resolve([])
  return guard<NeteaseSong[]>('artistTopSongs', [], () => client.neteaseArtistTopSongs(id, limit))
}

function artistSongsNetease(args: unknown): Promise<NeteaseSong[]> {
  const id = asId(namedArgument(args, 'artistId'))
  const limit = asCount(namedArgument(args, 'limit'), 200, 500)
  const offset = asCount(namedArgument(args, 'offset'), 0, 100000)
  if (id === null) return Promise.resolve([])
  return guard<NeteaseSong[]>('artistSongs', [], () => client.neteaseArtistSongs(id, limit, offset))
}

function artistAlbumsNetease(args: unknown): Promise<NeteaseAlbumSummary[]> {
  const id = asId(namedArgument(args, 'artistId'))
  const limit = asCount(namedArgument(args, 'limit'), 60, 200)
  const offset = asCount(namedArgument(args, 'offset'), 0, 100000)
  if (id === null) return Promise.resolve([])
  return guard<NeteaseAlbumSummary[]>('artistAlbums', [], () =>
    client.neteaseArtistAlbums(id, limit, offset)
  )
}

/*
 * 推荐位：每日推荐、私人漫游、云盘。
 *
 * 三条都是「平台今天给我的」，但上游分得很开：日推一天一批、漫游一次几首、
 * 云盘是账号里自己存的。所以各登记一条，而不是塞进一个 kind 参数。
 */
function dailySongsNetease(): Promise<NeteaseSong[]> {
  return guard<NeteaseSong[]>('dailySongs', [], () => client.neteaseDailySongs())
}

function personalFmNetease(args: unknown): Promise<NeteaseSong[]> {
  // 旧通道对非有限值退到 3 首，这里保持：漫游的每次取流由调用方定大小。
  const raw = namedArgument(args, 'limit')
  const limit = typeof raw === 'number' && Number.isFinite(raw) ? raw : 3
  return guard<NeteaseSong[]>('personalFm', [], () => client.neteasePersonalFm(limit))
}

function cloudSongsNetease(): Promise<NeteaseSong[]> {
  return guard<NeteaseSong[]>('cloudSongs', [], () => client.neteaseCloudSongs())
}

/**
 * 发现页一个板块的内容。
 *
 * 三个板块（推荐歌单 / 新歌 / 榜单）由 kind 区分，形状只差在数组里装的是歌
 * 还是歌单，所以只有这一条通道。offset 是「换一批」的游标；新歌那一路没有
 * 第二页，收下但不参与查询（见 client.neteaseDiscover 的注释）。
 */
function discoverNetease(args: unknown): Promise<NeteaseDiscoverResult> {
  const record = asRecord(args)
  const kind = asDiscoverKind(record.kind)
  const empty: NeteaseDiscoverResult = { kind: kind ?? 'playlists', songs: [], playlists: [] }
  if (!kind) return Promise.resolve(empty)
  return guard<NeteaseDiscoverResult>('discover', empty, () =>
    client.neteaseDiscover(kind, asDiscoverLimit(record.limit), asDiscoverOffset(record.offset))
  )
}

/** 歌曲详情：一首或多首。空清单不发请求，直接答空。 */
function songDetailNetease(args: unknown): Promise<NeteaseSong[]> {
  const ids = asIds(namedArgument(args, 'ids'))
  if (ids.length === 0) return Promise.resolve([])
  return guard<NeteaseSong[]>('songDetail', [], () => client.neteaseSongDetail(ids))
}

/** 切账号档案时把在线会话一并切过去。空 id 交给绑定层，它认得什么是空。 */
function setProfileNetease(args: unknown): boolean {
  const raw = namedArgument(args, 'profileId')
  return client.setActiveProfile(typeof raw === 'string' ? raw : '')
}

/*
 * 评论三件事：读一页、发一条、赞一条。
 *
 * 三个判据各自独立，逐字照搬旧 handle：cursor 截 32 位、limit 夹 1..50 默认 20、
 * 发评论要非空内容、点赞要布尔值。搬家不改语义，改的是「谁在调」——从页面直接
 * 摸桥，变成登记到网关再由通道转过来。
 */
async function commentsNetease(args: unknown): Promise<CommentPage | null> {
  const payload = asRecord(args)
  const songId = asId(payload.songId)
  if (songId === null) return null
  const cursor = typeof payload.cursor === 'string' ? payload.cursor.slice(0, 32) : ''
  const limit =
    typeof payload.limit === 'number' ? Math.min(50, Math.max(1, Math.trunc(payload.limit))) : 20
  return guard<CommentPage | null>('comments', null, () => client.neteaseComments(songId, cursor, limit))
}

async function commentSendNetease(args: unknown): Promise<CommentWriteResult> {
  const payload = asRecord(args)
  const songId = asId(payload.songId)
  const content = asText(payload.content, MAX_COMMENT_TEXT)
  const refused: CommentWriteResult = { ok: false, message: '评论内容无效' }
  if (songId === null || !content) return refused
  return guard<CommentWriteResult>('commentSend', refused, () => client.neteaseCommentSend(songId, content))
}

async function commentLikeNetease(args: unknown): Promise<CommentWriteResult> {
  const payload = asRecord(args)
  const songId = asId(payload.songId)
  const commentId = asId(payload.commentId)
  const refused: CommentWriteResult = { ok: false, message: '评论 ID 无效' }
  if (songId === null || commentId === null) return refused
  if (typeof payload.liked !== 'boolean') return refused
  const liked = payload.liked
  return guard<CommentWriteResult>('commentLike', refused, () =>
    client.neteaseCommentLike(songId, commentId, liked)
  )
}

/**
 * 新碟榜：首页「推荐专辑」那排里唯一真·榜单的来源。
 *
 * 它不看账号（新碟不是用户数据），所以也不需要 status 那一层。判据逐字照搬
 * 旧 handle：非有限数就退回 24 / 0，不做上下限收紧——要多少由调用方算。
 */
async function newAlbumsNetease(args: unknown): Promise<NeteaseCollectedAlbum[]> {
  const payload = asRecord(args)
  const limit =
    typeof payload.limit === 'number' && Number.isFinite(payload.limit) ? payload.limit : 24
  const offset =
    typeof payload.offset === 'number' && Number.isFinite(payload.offset) ? payload.offset : 0
  return guard<NeteaseCollectedAlbum[]>('topAlbums', [], () => client.neteaseTopAlbums(limit, offset))
}

/*
 * 取播放地址。判据逐字照搬旧 handle：id 不合法就是「歌曲 ID 无效」，质量档
 * 缺省时用账号当前存的那一档。
 */
async function streamUrlNetease(args: unknown): Promise<NeteaseStreamResult> {
  const record = asRecord(args)
  const songId = asId(record.songId)
  if (songId === null) {
    return { ok: false, reason: 'unknown', message: '歌曲 ID 无效' }
  }
  const quality = asQuality(record.quality) ?? currentQuality()
  return guard('streamUrl', unknownStream(), () => client.neteaseStreamUrl(songId, quality))
}

/*
 * 账号里的两组关系：收藏的专辑、关注的艺人。
 *
 * 展示型读取，读不到就是空的——与旧通道一致。页面把空画成「还没收藏」，这一
 * 版不改语义（那要连三条页面一起改）。
 */
function collectedAlbumsNetease(): Promise<NeteaseCollectedAlbum[]> {
  return guard<NeteaseCollectedAlbum[]>('albumSublist', [], () => client.neteaseAlbumSublist())
}

function followedArtistsNetease(): Promise<NeteaseFollowedArtist[]> {
  return guard<NeteaseFollowedArtist[]>('artistSublist', [], () => client.neteaseArtistSublist())
}

/*
 * 音质：读、写本地偏好。
 *
 * 不套 guard：这两步不碰网络，写设置不会因为上游抖动失败。坏档位退回当前值
 * ——渲染层那份档位表是唯一来源，给个不认识的值是 bug 或旧构建，往 settings
 * 里写垃圾比保留原档更糟。
 */
function qualityGetNetease(): NeteaseQuality {
  return currentQuality()
}

function qualitySetNetease(args: unknown): NeteaseQuality {
  const quality = asQuality(namedArgument(args, 'quality'))
  if (!quality) return currentQuality()
  const saved = saveSettings({ neteaseQuality: quality }).neteaseQuality
  return isNeteaseQuality(saved) ? saved : quality
}

/*
 * 自己建的歌单：建、加减歌、改名、删单。
 *
 * 改动会落在这个账号上，所以每处先过类型闸门；失败回 false/null 让页面自己说。
 * 参数从旧通道的 `{id, trackIds}` 换成 `{playlistId, songIds}`，两条入口由
 * 下面的薄壳翻译——判据只有这一份。
 */
function playlistCreateNetease(args: unknown): Promise<{ id: number; name: string } | null> {
  const name = asText(namedArgument(args, 'name'), 60)
  if (!name) return Promise.resolve(null)
  return guard<{ id: number; name: string } | null>('playlistCreate', null, () =>
    client.neteasePlaylistCreate(name)
  )
}

function playlistAddTracksNetease(args: unknown): Promise<boolean> {
  const playlistId = asId(namedArgument(args, 'playlistId'))
  const songIds = asIds(namedArgument(args, 'songIds'))
  if (playlistId === null || songIds.length === 0) return Promise.resolve(false)
  return guard<boolean>('playlistAddTracks', false, () =>
    client.neteasePlaylistAddTracks(playlistId, songIds)
  )
}

function playlistRemoveTracksNetease(args: unknown): Promise<boolean> {
  const playlistId = asId(namedArgument(args, 'playlistId'))
  const songIds = asIds(namedArgument(args, 'songIds'))
  if (playlistId === null || songIds.length === 0) return Promise.resolve(false)
  return guard<boolean>('playlistRemoveTracks', false, () =>
    client.neteasePlaylistRemoveTracks(playlistId, songIds)
  )
}

function playlistRenameNetease(args: unknown): Promise<boolean> {
  const playlistId = asId(namedArgument(args, 'playlistId'))
  const name = asText(namedArgument(args, 'name'), 60)
  if (playlistId === null || !name) return Promise.resolve(false)
  return guard<boolean>('playlistRename', false, () => client.neteasePlaylistRename(playlistId, name))
}

function playlistDeleteNetease(args: unknown): Promise<boolean> {
  const playlistId = asId(namedArgument(args, 'playlistId'))
  if (playlistId === null) return Promise.resolve(false)
  return guard<boolean>('playlistDelete', false, () => client.neteasePlaylistDelete(playlistId))
}

export function registerNeteaseIpc(): void {

  /*
   * Which profile the following calls belong to.
   *
   * The session lives here and the notion of "who is using the app" lives in the
   * renderer, so the renderer has to say. Registered first because every other
   * handler below depends on it having been called at least once.
   */
  ipcMain.handle('netease:setProfile', (_event, value: unknown) => setProfileNetease({ profileId: value }))
  registerProviderCapability('netease', 'setProfile', setProfileNetease)

  ipcMain.handle('netease:accountFor', (_event, value: unknown) => accountForNetease(value))
  registerProviderCapability('netease', 'accountFor', accountForNetease)

  ipcMain.handle('netease:logoutProfile', (_event, value: unknown) => logoutProfileNetease(value))
  registerProviderCapability('netease', 'logoutProfile', logoutProfileNetease)

  ipcMain.handle('netease:status', () => statusNetease())
  registerProviderCapability('netease', 'status', statusNetease)

  ipcMain.handle('netease:search', (_event, payload: unknown) => searchNetease(payload))
  registerProviderCapability('netease', 'search', searchNetease)

  ipcMain.handle('netease:streamUrl', (_event, payload: unknown) => streamUrlNetease(payload))
  registerProviderCapability('netease', 'playback', streamUrlNetease)

  ipcMain.handle('netease:lyrics', (_event, value: unknown) => lyricsNetease(value))
  registerProviderCapability('netease', 'lyrics', lyricsNetease)

  ipcMain.handle('netease:commentSend', (_event, payload: unknown) => commentSendNetease(payload))
  registerProviderCapability('netease', 'commentSend', commentSendNetease)

  ipcMain.handle('netease:commentLike', (_event, payload: unknown) => commentLikeNetease(payload))
  registerProviderCapability('netease', 'commentLike', commentLikeNetease)

  ipcMain.handle('netease:comments', (_event, payload: unknown) => commentsNetease(payload))
  registerProviderCapability('netease', 'comments', commentsNetease)

  ipcMain.handle('netease:album', (_event, value: unknown) => albumNetease({ albumId: value }))
  registerProviderCapability('netease', 'album', albumNetease)

  ipcMain.handle('netease:artistTopSongs', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return artistTopSongsNetease({ artistId: args.id, limit: args.limit })
  })
  registerProviderCapability('netease', 'artistTopSongs', artistTopSongsNetease)

  ipcMain.handle('netease:artistDetail', (_event, value: unknown) =>
    artistDetailNetease({ artistId: value })
  )
  registerProviderCapability('netease', 'artistDetail', artistDetailNetease)

  ipcMain.handle('netease:artistSongs', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return artistSongsNetease({ artistId: args.id, limit: args.limit, offset: args.offset })
  })
  registerProviderCapability('netease', 'artistSongs', artistSongsNetease)

  ipcMain.handle('netease:artistAlbums', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return artistAlbumsNetease({ artistId: args.id, limit: args.limit, offset: args.offset })
  })
  registerProviderCapability('netease', 'artistAlbums', artistAlbumsNetease)

  ipcMain.handle('netease:songDetail', (_event, value: unknown) => songDetailNetease({ ids: value }))
  registerProviderCapability('netease', 'songDetail', songDetailNetease)

  ipcMain.handle('netease:qrCreate', () => qrCreateNetease())
  registerProviderCapability('netease', 'qrCreate', qrCreateNetease)

  ipcMain.handle('netease:qrCheck', (_event, value: unknown) => qrCheckNetease(value))
  registerProviderCapability('netease', 'qrCheck', qrCheckNetease)

  ipcMain.handle('netease:loginCellphone', (_event, payload: unknown) => loginCellphoneNetease(payload))
  registerProviderCapability('netease', 'loginCellphone', loginCellphoneNetease)

  ipcMain.handle('netease:loginStatus', () => loginStatusNetease())
  registerProviderCapability('netease', 'loginStatus', loginStatusNetease)

  ipcMain.handle('netease:logout', () => logoutNetease())
  registerProviderCapability('netease', 'logout', logoutNetease)

  ipcMain.handle('netease:myPlaylists', () => myPlaylistsNetease())
  registerProviderCapability('netease', 'myPlaylists', myPlaylistsNetease)

  ipcMain.handle('netease:albumSublist', () => collectedAlbumsNetease())
  registerProviderCapability('netease', 'collectedAlbums', collectedAlbumsNetease)

  ipcMain.handle('netease:artistSublist', () => followedArtistsNetease())
  registerProviderCapability('netease', 'followedArtists', followedArtistsNetease)

  ipcMain.handle('netease:topAlbums', (_event, limit: unknown, offset: unknown) =>
    newAlbumsNetease({ limit, offset })
  )
  registerProviderCapability('netease', 'newAlbums', newAlbumsNetease)

  ipcMain.handle('netease:playlistTracks', (_event, value: unknown) => playlistTracksNetease(value))
  registerProviderCapability('netease', 'playlistTracks', playlistTracksNetease)

  ipcMain.handle('netease:playlistCreator', (_event, value: unknown) => playlistCreatorNetease(value))
  registerProviderCapability('netease', 'playlistCreator', playlistCreatorNetease)

  ipcMain.handle('netease:dailySongs', () => dailySongsNetease())
  registerProviderCapability('netease', 'dailySongs', dailySongsNetease)

  ipcMain.handle('netease:personalFm', (_event, limit: unknown) =>
    personalFmNetease({ limit })
  )
  registerProviderCapability('netease', 'personalFm', personalFmNetease)

  ipcMain.handle('netease:discover', (_event, payload: unknown) => discoverNetease(payload))
  registerProviderCapability('netease', 'discover', discoverNetease)

  ipcMain.handle('netease:cloudSongs', () => cloudSongsNetease())
  registerProviderCapability('netease', 'cloudSongs', cloudSongsNetease)

  ipcMain.handle('netease:likeList', () => likedNetease())
  registerProviderCapability('netease', 'liked', likedNetease)

  /*
   * 写操作：喜欢/取消喜欢。和其它通道一样不 reject——页面拿到 false 就说明
   * 「这次没改成」，可以提示登录或稍后重试，而不是在播放中途抛一个未处理异常。
   */
  ipcMain.handle('netease:like', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return likeNetease({ songId: args.id, liked: args.liked })
  })
  registerProviderCapability('netease', 'like', likeNetease)

  /*
   * 自己建的歌单：建、加歌、删歌、改名、删单。
   *
   * 和喜欢同一条规矩：不 reject，失败回 false/null 让页面自己说。不同之处是
   * 这些改动会改到平台账号，所以每一处都先过 asId/asText 的类型闸门——歌单 id
   * 是用户点出来的，但代码路径上它仍然是 unknown。
   */
  ipcMain.handle('netease:playlistCreate', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return playlistCreateNetease({ name: args.name })
  })
  registerProviderCapability('netease', 'playlistCreate', playlistCreateNetease)

  ipcMain.handle('netease:playlistAddTracks', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return playlistAddTracksNetease({ playlistId: args.id, songIds: args.trackIds })
  })
  registerProviderCapability('netease', 'playlistAddTracks', playlistAddTracksNetease)

  ipcMain.handle('netease:playlistRemoveTracks', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return playlistRemoveTracksNetease({ playlistId: args.id, songIds: args.trackIds })
  })
  registerProviderCapability('netease', 'playlistRemoveTracks', playlistRemoveTracksNetease)

  ipcMain.handle('netease:playlistRename', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return playlistRenameNetease({ playlistId: args.id, name: args.name })
  })
  registerProviderCapability('netease', 'playlistRename', playlistRenameNetease)

  ipcMain.handle('netease:playlistDelete', (_event, payload: unknown) => {
    const args = asRecord(payload)
    return playlistDeleteNetease({ playlistId: args.id })
  })
  registerProviderCapability('netease', 'playlistDelete', playlistDeleteNetease)

  ipcMain.handle('netease:getQuality', () => qualityGetNetease())
  registerProviderCapability('netease', 'qualityGet', qualityGetNetease)

  ipcMain.handle('netease:setQuality', (_event, value: unknown) =>
    qualitySetNetease({ quality: value })
  )
  registerProviderCapability('netease', 'qualitySet', qualitySetNetease)
}
