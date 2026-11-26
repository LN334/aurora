import type { LyricBundle } from '../lyrics/align'
import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 歌词在渲染层的统一入口。
 *
 * 主进程只搬两份原文：正文与译文。拼不拼、怎么对齐由渲染层的 align 决定——
 * 通道不做合并。这就是 0.10.1 重写歌词时定下的分工：译文是数据字段，不是从
 * 一行文本里猜出来的后缀，合并也就只能发生在一个地方。
 *
 * 读失败与「这首歌没有歌词」都返回 null（界面是同一种样子），但失败会留一行
 * 日志，排查时能分清是哪一种。
 */
export async function providerLyrics(
  provider: ProviderId,
  songId: string | number
): Promise<LyricBundle | null> {
  const answer = await askProvider<{ lrc?: string | null; translation?: string | null } | null>(
    provider,
    'lyrics',
    { songId }
  )
  if (!answer.ok) {
    warnChannel(provider, 'lyrics', answer.why)
    return null
  }
  return withParts(answer.value?.lrc, answer.value?.translation)
}

/**
 * 主进程交回的「正文 + 译文」-> bundle。
 *
 * 两份都空才是「没有歌词」。只有一份时另一份留空，由渲染层决定怎么显示。
 */
function withParts(
  lrc: string | null | undefined,
  translation: string | null | undefined
): LyricBundle | null {
  const body = lrc?.trim()
  const sub = translation?.trim()
  if (!body && !sub) return null
  return { lrc: body || '', translation: sub || null }
}
