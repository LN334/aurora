import { ipcMain } from 'electron'
import { write } from '../startup-log'
import type { CommentPage } from '../comments'
import {
  qishuiArtistProfile,
  qishuiArtistSongs,
  qishuiComments,
  qishuiFeed,
  qishuiLike,
  qishuiLiked,
  qishuiLyrics,
  qishuiPlaylistTracksEdit,
  qishuiLoginStatus,
  qishuiLogout,
  qishuiMyPlaylists,
  qishuiPlaylistCreator,
  qishuiPlaylistOwned,
  qishuiPlaylistTracks,
  qishuiQrCheck,
  qishuiQrCreate,
  qishuiSearch,
  qishuiSearchPlaylists,
  qishuiSong,
  qishuiStatus,
  qishuiStreamUrl,
  setActiveProfile
} from './client'
import { isQishuiQuality } from './types'
import { registerProviderCapability } from '../provider-gateway.ts'
import { namedArgument } from '../pure/provider-call.ts'
import type { QishuiQuality } from './types'

/**
 * 渲染层到汽水客户端的桥。
 *
 * 与酷狗同一套做法：每个通道都包在 guard 里（失败返回形状正确的兜底值，并在
 * 启动日志留一行），参数在这里洗一遍（长度、类型、枚举）。
 */

const MAX_KEYWORDS = 100
const MAX_ID = 64

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function asAlias(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return 0
}

function asQuality(value: unknown): QishuiQuality {
  return isQishuiQuality(value) ? value : 'standard'
}

async function guard<T>(
  label: string,
  fallback: T,
  run: () => Promise<T>,
  /* 见 netease/ipc.ts：读喜欢那条要分得清「空」与「没读到」。 */
  strict = false
): Promise<T> {
  try {
    const result = await run()
    write('qishui:' + label + ' ok')
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write('qishui:' + label + ' FAILED ' + message)
    console.error('[aurora] qishui:' + label + ' failed', message)
    if (strict) throw error
    return fallback
  }
}

/** 搜索：旧通道 `qishui:search` 与 `provider:call` 共用这一份实现。 */
function searchQishui(input: unknown) {
  const params = asRecord(input)
  const keywords = asText(params.keywords, MAX_KEYWORDS)
  const limit =
    typeof params.limit === 'number' ? Math.min(Math.max(Math.trunc(params.limit), 1), 60) : 50
  return guard('search', { songs: [] }, async () => {
    if (!keywords) return { songs: [] }
    return await qishuiSearch(keywords, limit)
  })
}

/** 歌词：旧通道 `qishui:lyrics` 与 `provider:call` 共用这一份实现。 */
function lyricsQishui(args: unknown) {
  const alias = asAlias(namedArgument(args, 'songId'))
  return guard('lyrics', null, async () => (alias ? await qishuiLyrics(alias) : null))
}

/*
 * 账号这一组：一份实现，旧通道与 `provider:call` 两个门（理由同网易云）。
 *
 * 汽水没有「按档案问账号」那两条：它的会话是单份的，切档案时分不到人身上。
 */
function statusQishui() {
  return guard('status', { ready: false, loggedIn: false, detail: '汽水接口不可用' }, async () =>
    qishuiStatus()
  )
}

function loginStatusQishui() {
  return guard('loginStatus', null, async () => qishuiLoginStatus())
}

function qrCreateQishui() {
  return guard('qrCreate', { key: '', imageDataUrl: '' }, async () => qishuiQrCreate())
}

function qrCheckQishui(args: unknown) {
  return guard('qrCheck', { status: 'failed', message: '暂时无法完成登录' }, async () =>
    qishuiQrCheck(asText(namedArgument(args, 'key'), MAX_ID))
  )
}

function logoutQishui() {
  return guard('logout', false, async () => qishuiLogout())
}

function searchPlaylistsQishui(args: unknown) {
  const keywords = asText(namedArgument(args, 'keywords'), MAX_KEYWORDS)
  const raw = namedArgument(args, 'limit')
  const limit = typeof raw === 'number' ? Math.min(Math.max(Math.trunc(raw), 1), 40) : 12
  return guard('searchPlaylists', [], async () => {
    if (!keywords) return []
    return await qishuiSearchPlaylists(keywords, limit)
  })
}

function myPlaylistsQishui(args: unknown) {
  const raw = namedArgument(args, 'limit')
  const count = typeof raw === 'number' ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 60
  return guard('myPlaylists', [], async () => qishuiMyPlaylists(count))
}

function playlistTracksQishui(args: unknown) {
  return guard('playlistTracks', [], async () => {
    const alias = asAlias(namedArgument(args, 'playlistId'))
    return alias ? await qishuiPlaylistTracks(alias) : []
  })
}

function playlistCreatorQishui(args: unknown) {
  return guard('playlistCreator', '', async () => {
    const alias = asAlias(namedArgument(args, 'playlistId'))
    return alias ? await qishuiPlaylistCreator(alias) : ''
  })
}

/* 归属只能在详情里判：列表的 owner_id 与登录态的加密 id 不同域。 */
function playlistOwnedQishui(args: unknown) {
  return guard('playlistOwned', null, async () => {
    const alias = asAlias(namedArgument(args, 'playlistId'))
    return alias ? await qishuiPlaylistOwned(alias) : null
  })
}

/*
 * 喜欢：读整张（liked）与写一条（like）。
 *
 * 读这一支照旧 strict——空数组与没读到是两件事，收藏页靠这个错误把「没读到」
 * 记进 failed、三十秒后再问（见 liked-merge）。写失败只回 false，界面照实提示。
 */
function likedQishui(args: unknown) {
  const raw = namedArgument(args, 'limit')
  const count = typeof raw === 'number' && raw > 0 ? Math.min(Math.trunc(raw), 300) : 200
  return guard('liked', [], async () => qishuiLiked(count), true)
}

function likeQishui(args: unknown) {
  return guard('like', false, async () => {
    const alias = asAlias(namedArgument(args, 'songId'))
    if (!alias || namedArgument(args, 'liked') === undefined) return false
    return await qishuiLike(alias, namedArgument(args, 'liked') === true)
  })
}

/*
 * 艺人页：资料与全部歌曲。汽水没有专辑页，上游的艺人歌曲也没有分页，offset 忽略。
 *
 * 这一批只搬家——失败仍折回 null / 空数组，与旧通道逐字段一致。
 */
function artistProfileQishui(args: unknown) {
  return guard('artistProfile', null, async () => {
    const alias = asAlias(namedArgument(args, 'artistId'))
    return alias ? await qishuiArtistProfile(alias) : null
  })
}

function artistSongsQishui(args: unknown) {
  const raw = namedArgument(args, 'limit')
  const limit = typeof raw === 'number' && raw > 0 ? Math.min(Math.trunc(raw), 200) : 100
  return guard('artistSongs', [], async () => {
    const alias = asAlias(namedArgument(args, 'artistId'))
    if (!alias) return []
    return await qishuiArtistSongs(alias, limit)
  })
}

/*
 * 推荐位两条，同一条上游流。
 *
 * 汽水没有「每日 30 首」那种列表接口，feed 就是这个平台的一天一批；它同时是
 * 漫游的取流。两条通道登记成两件事，是因为调用方的语义不同（一个要整批、一个
 * 要每次几首），而不是上游有两个接口——别在别处再给它编第三个数。
 */
function dailySongsQishui() {
  // 上游一次只给 30 条，多要也没用。
  return guard('dailySongs', [], async () => await qishuiFeed(30))
}

function personalFmQishui(args: unknown) {
  const raw = namedArgument(args, 'limit')
  const limit = typeof raw === 'number' ? Math.min(Math.max(Math.trunc(raw), 1), 30) : 12
  return guard('personalFm', [], async () => await qishuiFeed(limit))
}

/*
 * 读一页评论。汽水这边没有接发评论与点赞，所以只登记这一条。
 *
 * songId 是汽水的 alias（不是数字 id），空 alias 直接答 null——旧 handle 就是这个判据。
 */
async function commentsQishui(args: unknown): Promise<CommentPage | null> {
  const params = asRecord(args)
  const alias = asAlias(params.songId)
  const cursor = asText(params.cursor, MAX_ID)
  const limit =
    typeof params.limit === 'number' ? Math.min(50, Math.max(1, Math.trunc(params.limit))) : 20
  return await guard<CommentPage | null>('comments', null, async () =>
    alias ? await qishuiComments(alias, cursor, limit) : null
  )
}

/*
 * 取播放地址。汽水的 songId 是 alias 而不是数字 id：空 alias 答「缺少歌曲 id」，
 * 其余失败兜底 service-unavailable——两句都与旧 handle 一字不差。
 */
async function streamUrlQishui(input: unknown) {
  const params = asRecord(input)
  const alias = asAlias(params.songId)
  const quality = asQuality(params.quality)
  return await guard('streamUrl', { ok: false, reason: 'service-unavailable' }, async () => {
    if (!alias) return { ok: false, reason: 'unavailable', message: '缺少歌曲 id' }
    return await qishuiStreamUrl(alias, quality)
  })
}

/* 换档案：旧的 `qishui:setProfile` 与 `provider:call` 共用这一份实现。 */
function setProfileQishui(args: unknown): Promise<boolean> {
  const raw = namedArgument(args, 'profileId')
  return guard('setProfile', false, async () => setActiveProfile(asText(raw, MAX_ID) || 'default'))
}

/* 按 alias 取一首：旧 `qishui:song` 与 `provider:call` 共用。 */
function songQishui(args: unknown) {
  const alias = asAlias(namedArgument(args, 'songId'))
  return guard('song', null, async () => (alias ? await qishuiSong(alias) : null))
}

/* 加 / 删歌共用一条实现；`add` 决定方向，两个能力各自固定它。 */
function playlistTracksEditQishui(args: unknown): Promise<boolean> {
  const params = asRecord(args)
  const alias = asAlias(params.playlistId)
  const add = params.add === true
  const raw = Array.isArray(params.songIds) ? params.songIds : []
  const ids = raw.map(asAlias).filter((value) => value > 0).slice(0, 200)
  return guard('playlistTracksEdit', false, async () => {
    if (!alias || ids.length === 0) return false
    return await qishuiPlaylistTracksEdit(alias, ids, add)
  })
}

export function registerQishuiIpc(): void {
  ipcMain.handle('qishui:setProfile', async (_event, profileId: unknown) =>
    await setProfileQishui({ profileId })
  )
  registerProviderCapability('qishui', 'setProfile', setProfileQishui)

  ipcMain.handle('qishui:status', async () => statusQishui())
  registerProviderCapability('qishui', 'status', statusQishui)

  ipcMain.handle('qishui:loginStatus', async () => loginStatusQishui())
  registerProviderCapability('qishui', 'loginStatus', loginStatusQishui)

  ipcMain.handle('qishui:qrCreate', async () => qrCreateQishui())
  registerProviderCapability('qishui', 'qrCreate', qrCreateQishui)

  ipcMain.handle('qishui:qrCheck', async (_event, key: unknown) => qrCheckQishui(key))
  registerProviderCapability('qishui', 'qrCheck', qrCheckQishui)

  ipcMain.handle('qishui:logout', async () => logoutQishui())
  registerProviderCapability('qishui', 'logout', logoutQishui)

  ipcMain.handle('qishui:search', (_event, input: unknown) => searchQishui(input))
  registerProviderCapability('qishui', 'search', searchQishui)

  ipcMain.handle('qishui:searchPlaylists', async (_event, input: unknown) =>
    searchPlaylistsQishui(input)
  )
  registerProviderCapability('qishui', 'searchPlaylists', searchPlaylistsQishui)

  ipcMain.handle('qishui:song', async (_event, id: unknown) => await songQishui({ songId: id }))
  registerProviderCapability('qishui', 'song', songQishui)

  ipcMain.handle('qishui:streamUrl', async (_event, input: unknown) => await streamUrlQishui(input))
  registerProviderCapability('qishui', 'playback', streamUrlQishui)

  ipcMain.handle('qishui:lyrics', async (_event, id: unknown) => lyricsQishui(id))
  registerProviderCapability('qishui', 'lyrics', lyricsQishui)

  ipcMain.handle('qishui:comments', async (_event, input: unknown) => commentsQishui(input))
  registerProviderCapability('qishui', 'comments', commentsQishui)

  ipcMain.handle('qishui:myPlaylists', async (_event, limit: unknown) => myPlaylistsQishui(limit))
  registerProviderCapability('qishui', 'myPlaylists', myPlaylistsQishui)

  ipcMain.handle('qishui:playlistTracks', async (_event, id: unknown) => playlistTracksQishui(id))
  registerProviderCapability('qishui', 'playlistTracks', playlistTracksQishui)

  ipcMain.handle('qishui:playlistCreator', async (_event, id: unknown) => playlistCreatorQishui(id))
  registerProviderCapability('qishui', 'playlistCreator', playlistCreatorQishui)

  ipcMain.handle('qishui:playlistOwned', async (_event, id: unknown) => playlistOwnedQishui(id))
  registerProviderCapability('qishui', 'playlistOwned', playlistOwnedQishui)

  ipcMain.handle('qishui:artistProfile', async (_event, id: unknown) =>
    artistProfileQishui({ artistId: id })
  )
  registerProviderCapability('qishui', 'artistDetail', artistProfileQishui)

  ipcMain.handle('qishui:artistSongs', async (_event, input: unknown) => {
    const params = asRecord(input)
    return artistSongsQishui({ artistId: params.artistId, limit: params.limit })
  })
  registerProviderCapability('qishui', 'artistSongs', artistSongsQishui)

  ipcMain.handle('qishui:liked', async (_event, limit: unknown) => likedQishui({ limit }))
  registerProviderCapability('qishui', 'liked', likedQishui)

  // 上游一次只给 30 条，多要也没用。旧通道的默认值是 12（漫游），不是日推的 30。
  ipcMain.handle('qishui:feed', async (_event, limit: unknown) => personalFmQishui({ limit }))
  registerProviderCapability('qishui', 'personalFm', personalFmQishui)
  registerProviderCapability('qishui', 'dailySongs', dailySongsQishui)

  ipcMain.handle('qishui:like', async (_event, alias: unknown, liked: unknown) =>
    likeQishui({ songId: alias, liked })
  )
  registerProviderCapability('qishui', 'like', likeQishui)

  ipcMain.handle('qishui:playlistTracksEdit', async (_event, input: unknown) =>
    await playlistTracksEditQishui(input)
  )
  registerProviderCapability('qishui', 'playlistAddTracks', (args: unknown) =>
    playlistTracksEditQishui({ ...asRecord(args), add: true })
  )
  registerProviderCapability('qishui', 'playlistRemoveTracks', (args: unknown) =>
    playlistTracksEditQishui({ ...asRecord(args), add: false })
  )
}
