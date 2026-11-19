/**
 * B 站这条通道的形状。和 `electron/netease/types.ts` 一样，与 `src/env.d.ts`
 * 里的同名类型手工保持一致——两边分别被两套 tsconfig 编译。
 */

/** 共享档位里 B 站用得上的五个：它的音频轨就是这五级。 */
export type BilibiliQuality = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'hires'

export interface BilibiliVideo {
  /** 数字 id，作为共享层的歌曲 id。 */
  aid: number
  /** 字符串 id，取播放地址时用。 */
  bvid: string
  title: string
  author: string
  cover: string | null
  /** 秒。 */
  duration: number
  /** playurl 要的分段 id；搜索阶段是 0，取流时现查。 */
  cid: number
}

export interface BilibiliSearchResult {
  videos: BilibiliVideo[]
}

export type BilibiliStreamResult =
  | {
      ok: true
      stream: { url: string; br: number; level: BilibiliQuality; duration: number; trial: boolean }
    }
  | { ok: false; reason: string; message?: string }
