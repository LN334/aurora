import { ipcMain } from 'electron'
import { write } from '../startup-log'
import type { CommentPage, CommentWriteResult } from '../comments'
import {
  activeProfile,
  kugouAccountFor,
  kugouAlbum,
  kugouArtist,
  kugouArtistAlbums,
  kugouArtistSongs,
  kugouCommentSend,
  kugouComments,
  kugouDailyRecommend,
  kugouFollowedArtists,
  kugouGetQuality,
  kugouLike,
  kugouLikes,
  kugouLoginStatus,
  kugouLogout,
  kugouLyrics,
  kugouLogoutProfile,
  kugouMyPlaylists,
  kugouNewSongs,
  kugouPlaylistCreator,
  kugouPlaylistTracks,
  kugouPublicPlaylists,
  kugouQrCheck,
  kugouQrCreate,
  kugouSearch,
  kugouSetQuality,
  kugouStatus,
  kugouStreamUrl,
  setActiveProfile
} from './client'
import { isKugouQuality } from './types'
import { registerProviderCapability } from '../provider-gateway.ts'
import { namedArgument } from '../pure/provider-call.ts'
import type { KugouQuality } from './types'

/**
 * 渲染层到酷狗客户端的桥。
 *
 * 两层保护，理由和 QQ 那张表一样：
 * 1. **每个通道都包在 `guard` 里**。一次没被接住的拒绝会变成页面里一个卡住的
 *    加载态；这里改成「记录 + 返回一个形状正确的兜底值」。
 * 2. **参数在这里洗一遍**。`ipcMain.handle` 的入参来自页面，什么都不保证是
 *    字符串，也不保证长度——限制长度既避免把垃圾塞进上游查询，也让日志可读。
 */

const MAX_KEYWORDS = 100
const MAX_ID = 64

/** 评论正文的防爆上限；真正的 140 字限制在 client 里（那里要给出人话提示）。 */
const MAX_COMMENT_TEXT = 500

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function asId(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return asText(value, MAX_ID)
}

function asQuality(value: unknown): KugouQuality | undefined {
  return isKugouQuality(value) ? value : undefined
}

/**
 * 记录 + 兜底。成功也记一行：酷狗的多数失败在契约上不是异常（`streamUrl` 返回
 * `ok:false`），所以「这个通道被调用过」本身就是要留在 startup.log 里的事实。
 */
async function guard<T>(
  label: string,
  fallback: T,
  run: () => Promise<T>,
  /* 见 netease/ipc.ts：读喜欢那条要分得清「空」与「没读到」。 */
  strict = false
): Promise<T> {
  try {
    const result = await run()
    write(`kugou:${label} ok`)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write(`kugou:${label} FAILED ${message}`)
    console.error(`[aurora] kugou:${label} failed`, message)
    if (strict) throw error
    return fallback
  }
}

/** 搜索：旧通道 `kugou:search` 与 `provider:call` 共用这一份实现。 */
function searchKugou(input: unknown) {
  const params = asRecord(input)
  const keywords = asText(params.keywords, MAX_KEYWORDS)
  const type = params.type === 'album' || params.type === 'artist' ? params.type : 'song'
  const limit = typeof params.limit === 'number' ? Math.min(Math.max(Math.trunc(params.limit), 1), 60) : 50
  return guard('search', { songs: [], albums: [], artists: [] }, async () => {
    if (!keywords) return { songs: [], albums: [], artists: [] }
    return await kugouSearch(keywords, type, limit)
  })
}

/** 歌词：旧通道 `kugou:lyrics` 与 `provider:call` 共用这一份实现。 */
function lyricsKugou(args: unknown) {
  const songId = asId(namedArgument(args, 'songId'))
  return guard('lyrics', null, async () => kugouLyrics(songId))
}

/* 账号这一组：一份实现，旧通道与 `provider:call` 两个门（理由同网易云）。 */
function statusKugou() {
  return guard('status', { ready: false, loggedIn: false, detail: '酷狗接口不可用' }, async () =>
    kugouStatus()
  )
}

function accountForKugou(args: unknown) {
  return guard('accountFor', null, async () =>
    kugouAccountFor(asText(namedArgument(args, 'profileId'), MAX_ID) || 'default')
  )
}

function logoutProfileKugou(args: unknown) {
  return guard('logoutProfile', false, async () =>
    kugouLogoutProfile(asText(namedArgument(args, 'profileId'), MAX_ID) || activeProfile())
  )
}

function qrCreateKugou() {
  return guard('qrCreate', { key: '', imageDataUrl: '' }, async () => kugouQrCreate())
}

function qrCheckKugou(args: unknown) {
  return guard('qrCheck', { status: 'failed', message: '暂时无法完成登录' }, async () =>
    kugouQrCheck(asText(namedArgument(args, 'key'), MAX_ID))
  )
}

function loginStatusKugou() {
  return guard('loginStatus', null, async () => kugouLoginStatus())
}

function logoutKugou() {
  return guard('logout', false, async () => kugouLogout())
}

function myPlaylistsKugou(args: unknown) {
  const limit = namedArgument(args, 'limit')
  const count = typeof limit === 'number' ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 60
  return guard('myPlaylists', [], async () => kugouMyPlaylists(count))
}

/** 公开推荐歌单：首页那片「平台推荐了什么」里的酷狗一格。 */
function recommendPlaylistsKugou(args: unknown) {
  const limit = namedArgument(args, 'limit')
  const count = typeof limit === 'number' ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 24
  return guard('recommendPlaylists', [], async () => kugouPublicPlaylists(count))
}

function playlistTracksKugou(args: unknown) {
  return guard('playlistTracks', [], async () => {
    const playlistId = asId(namedArgument(args, 'playlistId'))
    if (playlistId === '') return []
    return await kugouPlaylistTracks(playlistId)
  })
}

function playlistCreatorKugou(args: unknown) {
  return guard('playlistCreator', '', async () => {
    const playlistId = asId(namedArgument(args, 'playlistId'))
    if (playlistId === '') return ''
    return await kugouPlaylistCreator(playlistId)
  })
}

/*
 * 喜欢：读整张（liked）与写一条（like）。
 *
 * 读这一支照旧 strict——空数组与没读到是两件事，收藏页靠这个错误把「没读到」
 * 记进 failed、三十秒后再问（见 liked-merge）。写失败只回 false，界面照实提示。
 */
function likedKugou(args: unknown) {
  const raw = namedArgument(args, 'limit')
  const count = typeof raw === 'number' && raw > 0 ? Math.min(Math.trunc(raw), 500) : 200
  return guard('liked', [], async () => kugouLikes(count), true)
}

function likeKugou(args: unknown) {
  return guard('like', false, async () => {
    const songId = Number(asId(namedArgument(args, 'songId')))
    if (!Number.isSafeInteger(songId) || songId <= 0) return false
    return await kugouLike(songId, namedArgument(args, 'liked') === true)
  })
}

/*
 * 专辑页与艺人页：一张专辑、一位艺人的资料、热门曲目、全部歌曲、专辑列表。
 *
 * 这一批只搬家——失败仍折回 null / 空数组，与旧通道逐字段一致。页面对空结果
 * 各有各的说法，改语义要把三条页面一起改，留作单独一版。
 */
function albumKugou(args: unknown) {
  return guard('album', null, async () => {
    const albumId = asId(namedArgument(args, 'albumId'))
    if (albumId === '') return null
    return await kugouAlbum(albumId)
  })
}

function artistKugou(args: unknown) {
  return guard('artist', null, async () => {
    const artistId = asId(namedArgument(args, 'artistId'))
    if (artistId === '') return null
    return await kugouArtist(artistId)
  })
}

function artistSongsKugou(args: unknown) {
  const rawLimit = namedArgument(args, 'limit')
  const rawOffset = namedArgument(args, 'offset')
  const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 200) : 100
  const offset = typeof rawOffset === 'number' && rawOffset > 0 ? Math.trunc(rawOffset) : 0
  return guard('artistSongs', [], async () => {
    const artistId = asId(namedArgument(args, 'artistId'))
    if (artistId === '') return []
    return await kugouArtistSongs(artistId, limit, offset)
  })
}

function artistAlbumsKugou(args: unknown) {
  const rawLimit = namedArgument(args, 'limit')
  const rawOffset = namedArgument(args, 'offset')
  const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 200) : 60
  const offset = typeof rawOffset === 'number' && rawOffset > 0 ? Math.trunc(rawOffset) : 0
  return guard('artistAlbums', [], async () => {
    const artistId = asId(namedArgument(args, 'artistId'))
    if (artistId === '') return []
    return await kugouArtistAlbums(artistId, limit, offset)
  })
}

/*
 * 推荐位两条：日推与新歌榜。
 *
 * 酷狗没有「私人漫游」这条上游接口：provider 那边用日推当漫游流，所以这里只登记
 * 日推，不登记一个永远空的 personalFm。
 */
function dailySongsKugou() {
  return guard('dailyRecommend', [], async () => await kugouDailyRecommend())
}

function newSongsKugou(args: unknown) {
  const raw = namedArgument(args, 'limit')
  const limit = typeof raw === 'number' ? Math.min(Math.max(Math.trunc(raw), 1), 60) : 20
  return guard('newSongs', [], async () => kugouNewSongs(limit))
}

/*
 * 评论两条：读一页、发一条。酷狗没有接点赞。
 *
 * 判据照搬旧 handle：酷狗这边**不校验 songId**（旧代码只看内容非空就让上游去答），
 * 移动时不顺手加一道，改了判据就不是搬家了。
 */
async function commentsKugou(args: unknown): Promise<CommentPage | null> {
  const params = asRecord(args)
  const songId = asId(params.songId)
  const cursor = asText(params.cursor, MAX_ID)
  const limit =
    typeof params.limit === 'number' ? Math.min(50, Math.max(1, Math.trunc(params.limit))) : 20
  return await guard<CommentPage | null>('comments', null, async () =>
    kugouComments(songId, cursor, limit)
  )
}

async function commentSendKugou(args: unknown): Promise<CommentWriteResult> {
  const params = asRecord(args)
  const songId = asId(params.songId)
  const content = asText(params.content, MAX_COMMENT_TEXT)
  const refused: CommentWriteResult = { ok: false, message: '评论内容无效' }
  if (!content) return refused
  return await guard<CommentWriteResult>('commentSend', refused, async () =>
    kugouCommentSend(songId, content)
  )
}

export function registerKugouIpc(): void {
  ipcMain.handle('kugou:setProfile', async (_event, profileId: unknown) =>
    guard('setProfile', false, async () => setActiveProfile(asText(profileId, MAX_ID) || 'default'))
  )

  ipcMain.handle('kugou:accountFor', async (_event, profileId: unknown) => accountForKugou(profileId))
  registerProviderCapability('kugou', 'accountFor', accountForKugou)

  ipcMain.handle('kugou:logoutProfile', async (_event, profileId: unknown) =>
    logoutProfileKugou(profileId)
  )
  registerProviderCapability('kugou', 'logoutProfile', logoutProfileKugou)

  ipcMain.handle('kugou:status', async () => statusKugou())
  registerProviderCapability('kugou', 'status', statusKugou)

  ipcMain.handle('kugou:search', (_event, input: unknown) => searchKugou(input))
  registerProviderCapability('kugou', 'search', searchKugou)

  ipcMain.handle('kugou:newSongs', async (_event, limit: unknown) => newSongsKugou({ limit }))
  registerProviderCapability('kugou', 'newSongs', newSongsKugou)

  ipcMain.handle('kugou:followedArtists', async () =>
    await guard('followedArtists', [], async () => kugouFollowedArtists())
  )

  ipcMain.handle('kugou:streamUrl', async (_event, input: unknown) => {
    const params = asRecord(input)
    const songId = asId(params.songId)
    const quality = asQuality(params.quality) ?? kugouGetQuality()
    return await guard('streamUrl', { ok: false, reason: 'service-unavailable' }, async () =>
      kugouStreamUrl(songId, quality)
    )
  })

  ipcMain.handle('kugou:lyrics', async (_event, songId: unknown) => lyricsKugou(songId))
  registerProviderCapability('kugou', 'lyrics', lyricsKugou)

  ipcMain.handle('kugou:comments', async (_event, input: unknown) => commentsKugou(input))
  registerProviderCapability('kugou', 'comments', commentsKugou)

  ipcMain.handle('kugou:commentSend', async (_event, input: unknown) => commentSendKugou(input))
  registerProviderCapability('kugou', 'commentSend', commentSendKugou)

  ipcMain.handle('kugou:qrCreate', async () => qrCreateKugou())
  registerProviderCapability('kugou', 'qrCreate', qrCreateKugou)

  ipcMain.handle('kugou:qrCheck', async (_event, key: unknown) => qrCheckKugou(key))
  registerProviderCapability('kugou', 'qrCheck', qrCheckKugou)

  ipcMain.handle('kugou:loginStatus', async () => loginStatusKugou())
  registerProviderCapability('kugou', 'loginStatus', loginStatusKugou)

  ipcMain.handle('kugou:logout', async () => logoutKugou())
  registerProviderCapability('kugou', 'logout', logoutKugou)

  ipcMain.handle('kugou:getQuality', async () =>
    guard('getQuality', 'exhigh' satisfies KugouQuality, async () => kugouGetQuality())
  )

  ipcMain.handle('kugou:setQuality', async (_event, quality: unknown) =>
    guard('setQuality', kugouGetQuality(), async () => {
      const next = asQuality(quality)
      if (!next) return kugouGetQuality()
      return kugouSetQuality(next)
    })
  )

  ipcMain.handle('kugou:myPlaylists', async (_event, limit: unknown) => myPlaylistsKugou(limit))
  registerProviderCapability('kugou', 'myPlaylists', myPlaylistsKugou)

  /*
   * 只走通道，没有旧 handle：这一支是这次新加的——首页推荐位不再拿账号歌单来填。
   */
  registerProviderCapability('kugou', 'recommendPlaylists', recommendPlaylistsKugou)

  ipcMain.handle('kugou:playlistTracks', async (_event, id: unknown) => playlistTracksKugou(id))
  registerProviderCapability('kugou', 'playlistTracks', playlistTracksKugou)

  ipcMain.handle('kugou:playlistCreator', async (_event, id: unknown) => playlistCreatorKugou(id))
  registerProviderCapability('kugou', 'playlistCreator', playlistCreatorKugou)

  ipcMain.handle('kugou:likes', async (_event, limit: unknown) => likedKugou({ limit }))
  registerProviderCapability('kugou', 'liked', likedKugou)

  ipcMain.handle('kugou:like', async (_event, id: unknown, liked: unknown) =>
    likeKugou({ songId: id, liked })
  )
  registerProviderCapability('kugou', 'like', likeKugou)

  ipcMain.handle('kugou:album', async (_event, id: unknown) => albumKugou({ albumId: id }))
  registerProviderCapability('kugou', 'album', albumKugou)

  ipcMain.handle('kugou:artist', async (_event, id: unknown) => artistKugou({ artistId: id }))
  registerProviderCapability('kugou', 'artistDetail', artistKugou)

  ipcMain.handle('kugou:artistSongs', async (_event, input: unknown) => {
    const params = asRecord(input)
    return artistSongsKugou({ artistId: params.id, limit: params.limit, offset: params.offset })
  })
  registerProviderCapability('kugou', 'artistSongs', artistSongsKugou)

  ipcMain.handle('kugou:artistAlbums', async (_event, input: unknown) => {
    const params = asRecord(input)
    return artistAlbumsKugou({ artistId: params.id, limit: params.limit, offset: params.offset })
  })
  registerProviderCapability('kugou', 'artistAlbums', artistAlbumsKugou)

  ipcMain.handle('kugou:dailyRecommend', () => dailySongsKugou())
  registerProviderCapability('kugou', 'dailySongs', dailySongsKugou)
}
