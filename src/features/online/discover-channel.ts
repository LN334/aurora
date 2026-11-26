import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 「发现」板块在渲染层的统一入口。
 *
 * 三个板块（推荐歌单 / 新歌 / 榜单）形状只差在数组里是歌还是歌单，一个 kind
 * 就能问完。失败折回空结果：首屏的一块内容读不到，页面画空态比画错误边界合适；
 * 警告里留着是哪一种失败。
 */
export async function providerDiscover<T>(
  provider: ProviderId,
  kind: string,
  limit: number | undefined,
  offset: number | undefined,
  fallback: T
): Promise<T> {
  const answer = await askProvider<T>(provider, 'discover', { kind, limit, offset })
  if (answer.ok && answer.value != null) return answer.value
  if (!answer.ok) warnChannel(provider, 'discover', answer.why)
  return fallback
}
