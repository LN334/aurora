import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 搜索在渲染层的统一入口。
 *
 * 一次请求回答三种结果（歌曲 / 专辑 / 艺人），调用方只用其中一栏：上游本来就是
 * 一起回的，为一个筛选条件再发两次请求是白花流量。类型参数就是那一栏的形状。
 *
 * 读失败折回 `fallback`：搜索框的失败态是「没搜到」，写一句警告比抛给页面更
 * 像用户看到的东西；调用方给的兜底也正是它要画的那个空态。
 */
export async function providerSearch<T>(
  provider: ProviderId,
  keywords: string,
  type: string,
  limit: number | undefined,
  fallback: T
): Promise<T> {
  const answer = await askProvider<T>(provider, 'search', { keywords, type, limit })
  if (answer.ok && answer.value != null) return answer.value
  if (!answer.ok) warnChannel(provider, 'search', answer.why)
  return fallback
}
