import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 「喜欢」在渲染层的统一入口：读一张账号里的喜欢列表，写一条喜欢。
 *
 * 与歌单、账号那两组有一处刻意的不同：**读失败在这里抛，不折成空数组**。
 * 收藏页要把「读完了，确实没有」和「没读到」画成两句不同的话（liked-merge 的
 * 三分解法就靠这个区分）；折成空数组等于替上游宣称「你一首都没喜欢过」，
 * 2026-11-17 那次上游断两秒、首页把没读到画成「0 首」就是这么来的。
 *
 * 写失败不抛：点红心失败是常态（未登录、上游拒），返回 false 由界面照实提示。
 */

/** 账号里喜欢的歌。失败抛，理由交给上层记进 failed 计数。 */
export async function providerLiked<T>(provider: ProviderId, limit?: number): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'liked', { limit })
  if (!answer.ok) {
    warnChannel(provider, 'liked', answer.why)
    throw new Error(answer.why)
  }
  return Array.isArray(answer.value) ? answer.value : []
}

/** 喜欢（true）或取消喜欢（false）。返回是否真的写成功。 */
export async function providerLike(
  provider: ProviderId,
  songId: number,
  liked: boolean
): Promise<boolean> {
  const answer = await askProvider<boolean>(provider, 'like', { songId, liked })
  if (answer.ok) return answer.value === true
  warnChannel(provider, 'like', answer.why)
  return false
}

/** QQ 账号里收藏的专辑。展示型读取，读不到就是空的。 */
export async function providerCollectedAlbums<T>(provider: ProviderId, limit?: number): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'collectedAlbums', { limit })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'collectedAlbums', answer.why)
  return []
}
