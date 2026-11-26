import type { ProviderId } from './types.ts'

/**
 * 通道调用的公共核。
 *
 * 各组（账号、歌单、收藏……）在渲染层各有一个入口文件，但「怎么问主进程、失败
 * 怎么记」只有这一份：通道名不经手，失败不在这儿变好也不变坏，只把「没走通」
 * 写进 console.warn——否则「平台没有」与「通道断了」在屏幕上就是同一句话。
 */

type ChannelAnswer<T> = { ok: true; value: T } | { ok: false; why: string }

export async function askProvider<T>(
  provider: ProviderId,
  capability: string,
  args?: unknown
): Promise<ChannelAnswer<T>> {
  const gateway = typeof window === 'undefined' ? null : window.aurora?.provider
  if (!gateway) return { ok: false, why: '没有主进程' }
  try {
    const answer = await gateway.call<T>(provider, capability, args)
    return answer.ok
      ? { ok: true, value: answer.value }
      : { ok: false, why: `${answer.error.code} ${answer.error.message}` }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }
}

export function warnChannel(provider: ProviderId, capability: string, why: string): void {
  console.warn(`[aurora] ${provider}.${capability} 未走通：${why}`)
}
