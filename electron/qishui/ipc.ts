import { ipcMain } from 'electron'
import { write } from '../startup-log'
import {
  qishuiArtistProfile,
  qishuiArtistSongs,
  qishuiFeed,
  qishuiLike,
  qishuiLiked,
  qishuiPlaylistTracksEdit,
  qishuiLoginStatus,
  qishuiLogout,
  qishuiMyPlaylists,
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

async function guard<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run()
    write('qishui:' + label + ' ok')
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    write('qishui:' + label + ' FAILED ' + message)
    console.error('[aurora] qishui:' + label + ' failed', message)
    return fallback
  }
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

  ipcMain.handle('qishui:search', async (_event, input: unknown) => {
    const params = asRecord(input)
    const keywords = asText(params.keywords, MAX_KEYWORDS)
    const limit =
      typeof params.limit === 'number' ? Math.min(Math.max(Math.trunc(params.limit), 1), 60) : 50
    return await guard('search', { songs: [] }, async () => {
      if (!keywords) return { songs: [] }
      return await qishuiSearch(keywords, limit)
    })
  })

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
    return await guard('liked', [], async () => qishuiLiked(count))
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
