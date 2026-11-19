import { ipcMain } from 'electron'
import { bilibiliSearch, bilibiliStreamUrl } from './client'
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

export function registerBilibiliIpc(): void {
  ipcMain.handle('bilibili:search', async (_event, args: unknown) => {
    const raw = asRecord(args)
    const keywords = typeof raw.keywords === 'string' ? raw.keywords : ''
    const limit = typeof raw.limit === 'number' && raw.limit > 0 ? raw.limit : 30
    try {
      return await bilibiliSearch(keywords, limit)
    } catch {
      return { videos: [] }
    }
  })

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
