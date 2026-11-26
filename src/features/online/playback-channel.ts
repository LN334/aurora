import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 「取播放地址」在渲染层的统一入口。
 *
 * 失败折回调用方给的兜底对象，不抛：取流失败是常态（未登录、会员、地区、
 * 上游抖动），而每一个理由都要原样画在播放条上。抛出去只会把 reason 丢掉，
 * 剩下界面自己编一句「播放失败」——那等于把五种原因说成一种。
 */

export async function providerStreamUrl<T>(
  provider: ProviderId,
  songId: number | string,
  quality: string | undefined,
  fallback: T
): Promise<T> {
  const answer = await askProvider<T>(provider, 'playback', { songId, quality })
  if (answer.ok) {
    // 拿不到形状正确的答复就当没答：把 undefined 交给播放器只会在几层之后炸。
    if (answer.value !== null && answer.value !== undefined) return answer.value
    return fallback
  }
  warnChannel(provider, 'playback', answer.why)
  return fallback
}
