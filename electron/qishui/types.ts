import type { QishuiApi } from '../../src/env'

/**
 * 汽水音乐这一层自己的类型。
 *
 * 与 `electron/qq/types.ts` / `electron/kugou/types.ts` 同一个位置：跨进程契约
 * 在 `src/env.d.ts` 的 `QishuiApi` 里，这里只放主进程内部要用的东西。
 */

export type QishuiQuality = 'standard' | 'high' | 'lossless' | 'hires'

export const QUALITIES: QishuiQuality[] = ['standard', 'high', 'lossless', 'hires']

export function isQishuiQuality(value: unknown): value is QishuiQuality {
  return typeof value === 'string' && (QUALITIES as string[]).includes(value)
}

/** 上游一行的原始形状只在这里出现；出了这个模块就只剩契约形状。 */
export interface QishuiRawTrack {
  id: string
  name: string
  durationMs: number
  albumId: string
  albumName: string
  artists: { id: string; name: string }[]
  coverUrl: string | null
}

export interface QishuiRawArtist {
  id: string
  name: string
  coverUrl: string | null
  description: string
  trackCount: number
}

export type QishuiApiSurface = QishuiApi
