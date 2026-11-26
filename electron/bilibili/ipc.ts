import { ipcMain } from 'electron'
import { bilibiliSearch, bilibiliStreamUrl } from './client'
import { registerProviderCapability } from '../provider-gateway.ts'
import { loginStatus, logout, qrCheck, qrCreate, setLoginProfile } from './login'
import type { BilibiliQuality } from './types'

/**
 * B 站这条通道的 IPC。
 *
 * 和另外四家一样「只接线不预热」：搜索要现签一次 WBI，取流要现查一次 view，
 * 都不适合在启动时先做掉。通道永远 resolve，不 reject——渲染层那边的每一次
 * 调用都按「可能拿到失败」写，抛异常会变成一处没人 catch 的未处理拒绝。
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

const QUALITIES: readonly BilibiliQuality[] = ['standard', 'higher', 'exhigh', 'lossless', 'hires']

function asQuality(value: unknown): BilibiliQuality {
  return typeof value === 'string' && (QUALITIES as readonly string[]).includes(value)
    ? (value as BilibiliQuality)
    : 'exhigh'
}

/** 稿件 id：数字，正整数。 */
function asAid(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/** 搜索：旧通道 `bilibili:search` 与 `provider:call` 共用这一份实现。 */
async function searchBilibili(args: unknown) {
  const raw = asRecord(args)
  const keywords = typeof raw.keywords === 'string' ? raw.keywords : ''
  const limit = typeof raw.limit === 'number' && raw.limit > 0 ? raw.limit : 30
  try {
    return await bilibiliSearch(keywords, limit)
  } catch {
    return { videos: [] }
  }
}

export function registerBilibiliIpc(): void {
  /*
   * 账号相关的四条通道。B 站匿名也能搜能播，登录换来的是搜索不至于被风控挡下
   * 以及更高档的音轨——所以这里的失败一律回「没有登录」，界面显示未登录，
   * 而不是一个点不动却不说原因的按钮。
   */
  ipcMain.handle('bilibili:setProfile', (_event, profileId: unknown) => {
    setLoginProfile(typeof profileId === 'string' && profileId ? profileId : 'default')
    return true
  })

  ipcMain.handle('bilibili:loginQr', async () => {
    try {
      return await qrCreate()
    } catch {
      return { key: '', imageDataUrl: '' }
    }
  })

  ipcMain.handle('bilibili:qrCheck', async (_event, args: unknown) => {
    const key = typeof asRecord(args).key === 'string' ? String(asRecord(args).key) : ''
    try {
      return await qrCheck(key)
    } catch {
      return { status: 'failed', message: '登录失败，稍后再试' }
    }
  })

  ipcMain.handle('bilibili:loginStatus', async () => {
    try {
      return await loginStatus()
    } catch {
      return null
    }
  })

  ipcMain.handle('bilibili:logout', () => {
    logout()
    return true
  })

  ipcMain.handle('bilibili:search', (_event, args: unknown) => searchBilibili(args))
  registerProviderCapability('bilibili', 'search', searchBilibili)

  ipcMain.handle('bilibili:streamUrl', async (_event, args: unknown) => {
    const raw = asRecord(args)
    const aid = asAid(raw.songId)
    if (!aid) return { ok: false, reason: 'unknown', message: '视频 ID 无效' }
    try {
      return await bilibiliStreamUrl(aid, asQuality(raw.quality))
    } catch {
      return { ok: false, reason: 'network', message: '取播放地址失败，稍后再试' }
    }
  })
}
