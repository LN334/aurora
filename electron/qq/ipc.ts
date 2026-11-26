import { ipcMain } from 'electron'
import { write } from '../startup-log'
import * as client from './client'
import { describeFailure } from './reasons'
import { registerProviderCapability } from '../provider-gateway.ts'
import { namedArgument } from '../pure/provider-call.ts'
import { isQqQuality } from './types'
import type { CommentPage, CommentWriteResult } from '../comments'
import type {
  QqAccount,
  QqAlbumBundle,
  QqCollectedAlbum,
  QqFollowedArtist,
  QqPlaylistSummary,
  QqQuality,
  QqQrResult,
  QqQrSession,
  QqSearchResult,
  QqSong,
  QqStatusResult,
  QqStreamResult
} from './types'

/**
 * The `qq:*` channels, and the place renderer input stops being trusted.
 *
 * Everything arrives as `unknown` from the page, so each argument is checked for
 * the shape its channel needs before it reaches the client. The ids are the
 * interesting case: QQ's playback identity is a `songmid` *string* while the
 * shared render shape is numeric, so both are accepted and the client resolves
 * whichever it gets.
 *
 * No channel rejects. A rejected `invoke` arrives in page code as an unhandled
 * rejection in the middle of a render, which for a player means a blank view
 * with no explanation; an empty result plus `qq:status` is the honest,
 * survivable failure.
 */

const MAX_KEYWORDS = 100
const MAX_SONGMID = 64
/** 防爆上限；真正的 500 字限制在 client。 */
const MAX_COMMENT_TEXT = 600
const SEARCH_TYPES = ['song', 'album', 'artist'] as const
type SearchType = (typeof SEARCH_TYPES)[number]

/** 正整数 id：歌单 tid 只会来自我们自己的列表。 */
const asPositive = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0)

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/**
 * A song identifier: either the `songmid` string or the numeric `songid`.
 *
 * Both are accepted because the renderer's shared shape carries the numeric id
 * while the play route needs the mid - passing through whichever the page has is
 * what lets one of them work rather than neither.
 */
function asSongId(value: unknown): string | number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > MAX_SONGMID) return null
    // A songmid is alphanumeric; a numeric string is a songid. Anything else
    // (spaces, punctuation, a URL) is not an identifier at all.
    return /^[A-Za-z0-9]+$/.test(trimmed) ? trimmed : null
  }
  return null
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function asQuality(value: unknown): QqQuality | null {
  return isQqQuality(value) ? value : null
}

function asSearchType(value: unknown): SearchType {
  return typeof value === 'string' && (SEARCH_TYPES as readonly string[]).includes(value)
    ? (value as SearchType)
    : 'song'
}

async function guard<T>(
  label: string,
  fallback: T,
  run: () => Promise<T>,
  /* 见 netease/ipc.ts：读喜欢那条要分得清「空」与「没读到」。 */
  strict = false
): Promise<T> {
  try {
    const value = await run()
    // 成功路径也记：失败时返回空结果与抛错在界面上一模一样。
    write(`qq:${label} ok`)
    return value
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write(`qq:${label} FAILED ${message}`)
    console.error(`[aurora] qq:${label} failed`, message)
    if (strict) throw error
    return fallback
  }
}


/** 搜索：旧通道 `qq:search` 与 `provider:call` 共用这一份实现（理由同网易云）。 */
function searchQq(args: unknown): Promise<QqSearchResult> {
  const record = asRecord(args)
  const keywords = asText(record.keywords, MAX_KEYWORDS)
  const type = asSearchType(record.type)
  const limit = typeof record.limit === 'number' ? record.limit : 50
  const empty: QqSearchResult = { songs: [], albums: [], artists: [] }
  if (!keywords) return Promise.resolve(empty)
  return guard('search', empty, () => client.qqSearch(keywords, type, limit))
}

/** 歌词：旧通道 `qq:lyrics` 与 `provider:call` 共用这一份实现。 */
function lyricsQq(args: unknown) {
  const songId = asSongId(namedArgument(args, 'songId'))
  if (songId === null) return null
  return guard('lyrics', null, () => client.qqLyrics(songId))
}

/* 账号这一组：一份实现，旧通道与 `provider:call` 两个门（理由同网易云）。 */
const statusFailure: QqStatusResult = { ready: false, loggedIn: false }

function statusQq(): Promise<QqStatusResult> {
  return guard('status', statusFailure, () => client.qqStatus())
}

function accountForQq(args: unknown): Promise<QqAccount | null> {
  const profileId = asText(namedArgument(args, 'profileId'), 64)
  if (!profileId) return Promise.resolve(null)
  return guard<QqAccount | null>('accountFor', null, () => client.qqAccountFor(profileId))
}

function logoutProfileQq(args: unknown): Promise<boolean> | boolean {
  const profileId = asText(namedArgument(args, 'profileId'), 64)
  if (!profileId) return false
  return client.qqLogoutProfile(profileId)
}

function qrCreateQq(): Promise<QqQrSession> {
  const empty: QqQrSession = { key: '', imageDataUrl: '' }
  return guard('qrCreate', empty, () => client.qqQrCreate())
}

function qrCheckQq(args: unknown): Promise<QqQrResult> {
  const key = asText(namedArgument(args, 'key'), 128)
  if (!key) return Promise.resolve({ status: 'failed', message: '二维码已失效，请重新获取' })
  const failed: QqQrResult = { status: 'failed', message: '登录状态查询失败，请重试' }
  return guard('qrCheck', failed, () => client.qqQrCheck(key))
}

function loginStatusQq(): Promise<QqAccount | null> {
  return guard<QqAccount | null>('loginStatus', null, () => client.qqLoginStatus())
}

function logoutQq(): Promise<boolean> {
  return guard('logout', false, () => client.qqLogout())
}

function myPlaylistsQq(args: unknown) {
  const raw = namedArgument(args, 'limit')
  const limit = typeof raw === 'number' && raw > 0 ? Math.min(Math.trunc(raw), 200) : 60
  return guard<QqPlaylistSummary[]>('myPlaylists', [], () => client.qqMyPlaylists(limit))
}

function playlistTracksQq(args: unknown) {
  // Playlist ids are numeric upstream but arrive as either shape.
  const raw = namedArgument(args, 'playlistId')
  const id = typeof raw === 'number' ? String(raw) : asText(raw, 32)
  if (!id) return Promise.resolve<QqSong[]>([])
  return guard<QqSong[]>('playlistTracks', [], () => client.qqPlaylistTracks(id))
}

function playlistCreatorQq(args: unknown) {
  const raw = namedArgument(args, 'playlistId')
  const numeric = typeof raw === 'number' ? raw : Number(asText(raw, 32))
  if (!Number.isFinite(numeric) || numeric <= 0) return Promise.resolve('')
  return guard<string>('playlistCreator', '', () => client.qqPlaylistCreator(numeric))
}

function recommendPlaylistsQq(args: unknown) {
  const raw = namedArgument(args, 'limit')
  const limit = typeof raw === 'number' && raw > 0 ? Math.min(Math.trunc(raw), 40) : 12
  return guard<QqPlaylistSummary[]>('recommendPlaylists', [], () =>
    client.qqRecommendPlaylists(limit)
  )
}

function playlistOwnedQq() {
  return guard<{ id: number; name: string }[]>('playlistOwned', [], async () => {
    const rows = await client.qqOwnedPlaylists()
    return rows
      .filter((row) => row.dirType === 0 && row.dirId < 200)
      .map((row) => ({ id: row.tid, name: row.name }))
  })
}

/*
 * 喜欢：读整张（liked）、写一条（like），以及 QQ 独有的「收藏的专辑」。
 *
 * 读这一支照旧 strict——空数组与没读到是两件事，收藏页靠这个错误把「没读到」
 * 记进 failed、三十秒后再问（见 liked-merge）。写失败只回 false，界面照实提示。
 */
function likedQq(): Promise<QqSong[]> {
  return guard<QqSong[]>('liked', [], () => client.qqLiked(), true)
}

function likeQq(args: unknown): Promise<boolean> {
  const songId = Number(asSongId(namedArgument(args, 'songId')))
  if (!Number.isSafeInteger(songId) || songId <= 0) return Promise.resolve(false)
  const liked = namedArgument(args, 'liked') === true
  return guard<boolean>('like', false, () => client.qqLike(songId, liked))
}

function collectedAlbumsQq(args: unknown): Promise<QqCollectedAlbum[]> {
  const raw = namedArgument(args, 'limit')
  const limit = typeof raw === 'number' && raw > 0 ? Math.min(Math.trunc(raw), 200) : 200
  return guard<QqCollectedAlbum[]>('collectedAlbums', [], () => client.qqCollectedAlbums(limit))
}

/** 一张专辑（曲目在里面）。QQ 没有艺人页，所以只有这一条。 */
function albumQq(args: unknown): Promise<QqAlbumBundle | null> {
  const raw = namedArgument(args, 'albumId')
  const id = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0
  if (!id) return Promise.resolve<null>(null)
  return guard<QqAlbumBundle | null>('album', null, () => client.qqAlbum(id))
}

export function registerQqIpc(): void {

  ipcMain.handle('qq:setProfile', (_event, value: unknown) => {
    const id = asText(value, 64)
    if (!id) return false
    return client.setActiveProfile(id)
  })

  ipcMain.handle('qq:accountFor', (_event, value: unknown) => accountForQq(value))
  registerProviderCapability('qq', 'accountFor', accountForQq)

  ipcMain.handle('qq:logoutProfile', (_event, value: unknown) => logoutProfileQq(value))
  registerProviderCapability('qq', 'logoutProfile', logoutProfileQq)

  ipcMain.handle('qq:status', () => statusQq())
  registerProviderCapability('qq', 'status', statusQq)

  ipcMain.handle('qq:search', (_event, payload: unknown) => searchQq(payload))
  registerProviderCapability('qq', 'search', searchQq)

  ipcMain.handle('qq:streamUrl', (_event, payload: unknown) => {
    const args = asRecord(payload)
    const songId = asSongId(args.songId)
    if (songId === null) {
      return { ok: false, reason: 'unknown', message: '歌曲编号无效' } satisfies QqStreamResult
    }
    // The tier is optional: the client falls back to the profile's saved
    // preference, so a renderer that has not read it yet still gets an answer.
    const quality = asQuality(args.quality)
    const unknown: QqStreamResult = {
      ok: false,
      reason: 'unknown',
      message: describeFailure('unknown')
    }
    return guard('streamUrl', unknown, () => client.qqStreamUrl(songId, quality ?? undefined))
  })

  ipcMain.handle('qq:lyrics', (_event, value: unknown) => lyricsQq(value))
  registerProviderCapability('qq', 'lyrics', lyricsQq)

  ipcMain.handle('qq:comments', (_event, payload: unknown) => {
    const args = asRecord(payload)
    const songId = asSongId(args.songId)
    if (songId === null) return null
    const cursor = typeof args.cursor === 'string' ? args.cursor.slice(0, 32) : ''
    const limit =
      typeof args.limit === 'number' ? Math.min(50, Math.max(1, Math.trunc(args.limit))) : 20
    return guard<CommentPage | null>('comments', null, () =>
      client.qqComments(songId, cursor, limit)
    )
  })

  ipcMain.handle('qq:commentSend', (_event, payload: unknown) => {
    const args = asRecord(payload)
    const songId = asSongId(args.songId)
    const content = asText(args.content, MAX_COMMENT_TEXT)
    const refused: CommentWriteResult = { ok: false, message: '评论内容无效' }
    if (songId === null || content === null) return refused
    return guard<CommentWriteResult>('commentSend', refused, () =>
      client.qqCommentSend(songId, content)
    )
  })

  ipcMain.handle('qq:qrCreate', () => qrCreateQq())
  registerProviderCapability('qq', 'qrCreate', qrCreateQq)

  ipcMain.handle('qq:qrCheck', (_event, value: unknown) => qrCheckQq(value))
  registerProviderCapability('qq', 'qrCheck', qrCheckQq)

  ipcMain.handle('qq:loginStatus', () => loginStatusQq())
  registerProviderCapability('qq', 'loginStatus', loginStatusQq)

  ipcMain.handle('qq:logout', () => logoutQq())
  registerProviderCapability('qq', 'logout', logoutQq)

  ipcMain.handle('qq:getQuality', () => client.qqGetQuality())

  ipcMain.handle('qq:setQuality', (_event, value: unknown) => {
    const quality = asQuality(value)
    // An unknown tier is not worth an error: the renderer's own list is the only
    // source, so this is a bug or a stale build, and either way keeping the
    // current value beats writing nonsense into the profile.
    if (!quality) return client.qqGetQuality()
    return client.qqSetQuality(quality)
  })

  // A library read is not a failure when it answers nothing: signed out, or an
  // upstream blip, both mean "nothing to list right now", and the interface shows
  // an empty shelf rather than an error it cannot act on.
  ipcMain.handle('qq:myPlaylists', (_event, value: unknown) => myPlaylistsQq(value))
  registerProviderCapability('qq', 'myPlaylists', myPlaylistsQq)

  ipcMain.handle('qq:playlistTracks', (_event, value: unknown) => playlistTracksQq(value))
  registerProviderCapability('qq', 'playlistTracks', playlistTracksQq)

  ipcMain.handle('qq:playlistCreator', (_event, value: unknown) => playlistCreatorQq(value))
  registerProviderCapability('qq', 'playlistCreator', playlistCreatorQq)

  // 公开推荐歌单：不需要账号，首页那片「歌单」在没人登录时也能有 QQ 的份。
  ipcMain.handle('qq:recommendPlaylists', (_event, value: unknown) => recommendPlaylistsQq(value))
  registerProviderCapability('qq', 'recommendPlaylists', recommendPlaylistsQq)

  ipcMain.handle('qq:newSongs', (_event, value: unknown) => {
    const limit = typeof value === 'number' ? Math.min(Math.max(Math.trunc(value), 1), 60) : 20
    return guard<QqSong[]>('newSongs', [], () => client.qqNewSongs(limit))
  })

  ipcMain.handle('qq:daily', () => guard<QqSong[]>('daily', [], () => client.qqDaily()))

  ipcMain.handle('qq:liked', () => likedQq())
  registerProviderCapability('qq', 'liked', likedQq)

  /*
   * 点红心是写操作。上游对扫码登录的 cookie 认得不稳（每日推荐一律 500003 就是
   * 这个毛病），所以这里只如实回 true/false：client 先读、再写、再读回来核对，
   * 读不回来就答 false，页面提示「没写成」，不替上游宣称成功。
   */
  ipcMain.handle('qq:like', (_event, value: unknown, liked: unknown) => likeQq({ songId: value, liked }))
  registerProviderCapability('qq', 'like', likeQq)

  /*
   * 歌单写。界面的歌单 id 是 tid（dissid），加删改名都要它；上游真正认的是 dirId，
   * 由 client→transport 现读现换，这里不缓存，免得用户刚在 QQ 里改过就写错单。
   */
  ipcMain.handle('qq:playlistOwned', () => playlistOwnedQq())
  registerProviderCapability('qq', 'playlistOwned', playlistOwnedQq)

  ipcMain.handle('qq:playlistCreate', (_event, value: unknown) => {
    const name = typeof value === 'string' ? value.trim().slice(0, 20) : ''
    if (!name) return Promise.resolve<null>(null)
    return guard<{ id: number; name: string } | null>('playlistCreate', null, () => client.qqPlaylistCreate(name))
  })

  ipcMain.handle('qq:playlistDelete', (_event, value: unknown) => {
    const tid = asPositive(value)
    if (!tid) return Promise.resolve(false)
    return guard<boolean>('playlistDelete', false, () => client.qqPlaylistDelete(tid))
  })

  ipcMain.handle('qq:playlistRename', (_event, value: unknown, name: unknown) => {
    const tid = asPositive(value)
    const title = typeof name === 'string' ? name.trim().slice(0, 20) : ''
    if (!tid || !title) return Promise.resolve(false)
    return guard<boolean>('playlistRename', false, () => client.qqPlaylistRename(tid, title))
  })

  /*
   * 加 / 删歌。songIds 与红心共用一份「见过的歌」缓存（songIndex），列表里没出现
   * 过的 id 会被上游静默丢掉，所以一批最多带 200 首，且只接受正整数。
   */
  ipcMain.handle('qq:playlistTracksEdit', (_event, value: unknown, ids: unknown, add: unknown) => {
    const tid = asPositive(value)
    if (!tid || !Array.isArray(ids)) return Promise.resolve(false)
    const songIds = ids
      .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
      .slice(0, 200)
    if (songIds.length === 0) return Promise.resolve(false)
    return guard<boolean>('playlistTracks', false, () => client.qqPlaylistTracksEdit(tid, songIds, add === true))
  })

  ipcMain.handle('qq:collectedAlbums', (_event, value: unknown) =>
    collectedAlbumsQq({ limit: value })
  )
  registerProviderCapability('qq', 'collectedAlbums', collectedAlbumsQq)

  ipcMain.handle('qq:followedArtists', (_event, value: unknown) => {
    const limit = typeof value === 'number' && value > 0 ? Math.min(value, 200) : 100
    return guard<QqFollowedArtist[]>('followedArtists', [], () => client.qqFollowedArtists(limit))
  })

  ipcMain.handle('qq:album', (_event, value: unknown) => albumQq({ albumId: value }))
  registerProviderCapability('qq', 'album', albumQq)
}