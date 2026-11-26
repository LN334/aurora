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

export function registerQishuiIpc(): void {
  ipcMain.handle('qishui:setProfile', async (_event, profileId: unknown) =>
    guard('setProfile', false, async () => setActiveProfile(asText(profileId, MAX_ID) || 'default'))
  )

  ipcMain.handle('qishui:status', async () =>
    guard('status', { ready: false, loggedIn: false, detail: '汽水接口不可用' }, async () => qishuiStatus())
  )

  ipcMain.handle('qishui:loginStatus', async () =>
    guard('loginStatus', null, async () => qishuiLoginStatus())
  )

  ipcMain.handle('qishui:qrCreate', async () =>
    guard('qrCreate', { key: '', imageDataUrl: '' }, async () => qishuiQrCreate())
  )

  ipcMain.handle('qishui:qrCheck', async (_event, key: unknown) =>
    guard('qrCheck', { status: 'failed', message: '暂时无法完成登录' }, async () =>
      qishuiQrCheck(asText(key, MAX_ID))
    )
  )

  ipcMain.handle('qishui:logout', async () => guard('logout', false, async () => qishuiLogout()))

  ipcMain.handle('qishui:search', (_event, input: unknown) => searchQishui(input))
  registerProviderCapability('qishui', 'search', searchQishui)

  ipcMain.handle('qishui:searchPlaylists', async (_event, input: unknown) => {
    const params = asRecord(input)
    const keywords = asText(params.keywords, MAX_KEYWORDS)
    const limit =
      typeof params.limit === 'number' ? Math.min(Math.max(Math.trunc(params.limit), 1), 40) : 12
    return await guard('searchPlaylists', [], async () => {
      if (!keywords) return []
      return await qishuiSearchPlaylists(keywords, limit)
    })
  })

  ipcMain.handle('qishui:song', async (_event, id: unknown) =>
    guard('song', null, async () => {
      const alias = asAlias(id)
      return alias ? await qishuiSong(alias) : null
    })
  )

  ipcMain.handle('qishui:streamUrl', async (_event, input: unknown) => {
    const params = asRecord(input)
    const alias = asAlias(params.songId)
    const quality = asQuality(params.quality)
    return await guard(
      'streamUrl',
      { ok: false, reason: 'service-unavailable' },
      async () => {
        if (!alias) return { ok: false, reason: 'unavailable', message: '缺少歌曲 id' }
        return await qishuiStreamUrl(alias, quality)
      }
    )
  })

  ipcMain.handle('qishui:lyrics', async (_event, id: unknown) =>
    guard('lyrics', null, async () => {
      const alias = asAlias(id)
      return alias ? await qishuiLyrics(alias) : null
    })
  )

  ipcMain.handle('qishui:comments', async (_event, input: unknown) => {
    const params = asRecord(input)
    const alias = asAlias(params.songId)
    const cursor = asText(params.cursor, MAX_ID)
    const limit =
      typeof params.limit === 'number' ? Math.min(50, Math.max(1, Math.trunc(params.limit))) : 20
    return await guard<CommentPage | null>('comments', null, async () =>
      alias ? await qishuiComments(alias, cursor, limit) : null
    )
  })

  ipcMain.handle('qishui:myPlaylists', async (_event, limit: unknown) => {
    const count = typeof limit === 'number' ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 60
    return await guard('myPlaylists', [], async () => qishuiMyPlaylists(count))
  })

  ipcMain.handle('qishui:playlistTracks', async (_event, id: unknown) =>
    guard('playlistTracks', [], async () => {
      const alias = asAlias(id)
      return alias ? await qishuiPlaylistTracks(alias) : []
    })
  )

  ipcMain.handle('qishui:playlistCreator', async (_event, id: unknown) =>
    guard('playlistCreator', '', async () => {
      const alias = asAlias(id)
      return alias ? await qishuiPlaylistCreator(alias) : ''
    })
  )
  /* 归属只能在详情里判：列表的 owner_id 与登录态的加密 id 不同域。 */
  ipcMain.handle('qishui:playlistOwned', async (_event, id: unknown) =>
    guard('playlistOwned', null, async () => {
      const alias = asAlias(id)
      return alias ? await qishuiPlaylistOwned(alias) : null
    })
  )

  ipcMain.handle('qishui:artistProfile', async (_event, id: unknown) =>
    guard('artistProfile', null, async () => {
      const alias = asAlias(id)
      return alias ? await qishuiArtistProfile(alias) : null
    })
  )

  ipcMain.handle('qishui:artistSongs', async (_event, input: unknown) => {
    const params = asRecord(input)
    const alias = asAlias(params.artistId)
    const limit =
      typeof params.limit === 'number' ? Math.min(Math.max(Math.trunc(params.limit), 1), 200) : 100
    return await guard('artistSongs', [], async () => {
      if (!alias) return []
      return await qishuiArtistSongs(alias, limit)
    })
  })

  ipcMain.handle('qishui:liked', async (_event, limit: unknown) => {
    const count = typeof limit === 'number' ? Math.min(Math.max(Math.trunc(limit), 1), 300) : 200
    return await guard('liked', [], async () => qishuiLiked(count), true)
  })

  // 上游一次只给 30 条，多要也没用。
  ipcMain.handle('qishui:feed', async (_event, limit: unknown) => {
    const count = typeof limit === 'number' ? Math.min(Math.max(Math.trunc(limit), 1), 30) : 12
    return await guard('feed', [], async () => qishuiFeed(count))
  })

  ipcMain.handle('qishui:like', async (_event, alias: unknown, liked: unknown) => {
    const id = asAlias(alias)
    return await guard('like', false, async () => {
      if (!id || typeof liked !== 'boolean') return false
      return await qishuiLike(id, liked)
    })
  })

  ipcMain.handle('qishui:playlistTracksEdit', async (_event, input: unknown) => {
    const params = asRecord(input)
    const alias = asAlias(params.playlistId)
    const add = params.add === true
    const raw = Array.isArray(params.songIds) ? params.songIds : []
    const ids = raw.map(asAlias).filter((value) => value > 0).slice(0, 200)
    return await guard('playlistTracksEdit', false, async () => {
      if (!alias || ids.length === 0) return false
      return await qishuiPlaylistTracksEdit(alias, ids, add)
    })
  })
}
