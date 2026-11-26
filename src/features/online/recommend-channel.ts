import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 推荐位与漫游在渲染层的入口。
 *
 * 上游四家给的形状差得远：网易云有「每日推荐」「私人漫游」「云盘」三条各自的
 * 接口，酷狗只有一条日推，汽水只有一条 feed（日推与漫游是同一份流），QQ 的日推
 * 对扫码登录的凭据一律答错、只能退到公开新歌。所以通道按**语义**登记：谁有
 * 「每日推荐」就登记 dailySongs，谁有「漫游」就登记 personalFm，兜底与组合留在
 * 渲染层的 provider 里——那是这一家的型号，不是上游的能力。
 *
 * 失败仍折空数组，与旧通道一致：一处推荐位读不到不该让整块变白。
 */

/** 平台今天给你的那一批。 */
export async function providerDailySongs<T>(provider: ProviderId): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'dailySongs', undefined)
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'dailySongs', answer.why)
  return []
}

/** 私人漫游的一次取流。没有 personalFm 的平台不该被问到（见 roam.ts 的判据）。 */
export async function providerPersonalFm<T>(provider: ProviderId, limit?: number): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'personalFm', { limit })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'personalFm', answer.why)
  return []
}

/** 账号里的音乐云盘。 */
export async function providerCloudSongs<T>(provider: ProviderId): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'cloudSongs', undefined)
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'cloudSongs', answer.why)
  return []
}

/** 公开的新歌榜：QQ 与酷狗都有，游客也读得到。 */
export async function providerNewSongs<T>(provider: ProviderId, limit?: number): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'newSongs', { limit })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'newSongs', answer.why)
  return []
}
