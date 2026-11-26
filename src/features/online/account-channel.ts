import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 账号这一组在渲染层的统一入口。
 *
 * 四家平台的登录框各写各的，但「问状态、要二维码、轮询、退出」在协议上是同
 * 四件事，只是通道名不同。收在这里之后，主进程那边改名只改一处，也不会再出现
 * 某一家漏改的错位。
 *
 * 失败在这里不变好，也不变坏：主进程的 `guard` 已经折回兜底值，这里额外做
 * 一件界面无法自己判断的事——把「通道没走通」写进 console.warn。否则「没登
 * 录」和「通道断了」在屏幕上是同一句话。兜底值由调用方给：只有它知道该说
 * 「二维码没拿到」还是「登录失败」。
 */


/** 平台是否就绪、是否已登录。失败时 null（「没问到」），调用方按未就绪处理。 */
export async function providerStatus<T>(provider: ProviderId): Promise<T | null> {
  const answer = await askProvider<T>(provider, 'status')
  if (answer.ok) return answer.value
  warnChannel(provider, 'status', answer.why)
  return null
}

/** 当前登录的账号，没登录就是 null。 */
export async function providerLoginStatus<T>(provider: ProviderId): Promise<T | null> {
  const answer = await askProvider<T>(provider, 'loginStatus')
  if (answer.ok) return answer.value
  warnChannel(provider, 'loginStatus', answer.why)
  return null
}

/** 某个档案绑着的账号，档案页用。 */
export async function providerAccountFor<T>(
  provider: ProviderId,
  profileId: string
): Promise<T | null> {
  const answer = await askProvider<T>(provider, 'accountFor', { profileId })
  if (answer.ok) return answer.value
  warnChannel(provider, 'accountFor', answer.why)
  return null
}

/** 让某个档案退出登录。 */
export async function providerLogoutProfile(
  provider: ProviderId,
  profileId: string
): Promise<boolean> {
  const answer = await askProvider<boolean>(provider, 'logoutProfile', { profileId })
  if (answer.ok) return answer.value === true
  warnChannel(provider, 'logoutProfile', answer.why)
  return false
}

/** 要一张新二维码。`empty` 是拿不到时的形状，与主进程的兜底一致。 */
export async function providerQrCreate<T>(provider: ProviderId, empty: T): Promise<T> {
  const answer = await askProvider<T>(provider, 'qrCreate')
  if (answer.ok) return answer.value
  warnChannel(provider, 'qrCreate', answer.why)
  return empty
}

/** 轮询一次二维码。`failed` 是查询本身没走通时的形状。 */
export async function providerQrCheck<T>(
  provider: ProviderId,
  key: string,
  failed: T
): Promise<T> {
  const answer = await askProvider<T>(provider, 'qrCheck', { key })
  if (answer.ok) return answer.value
  warnChannel(provider, 'qrCheck', answer.why)
  return failed
}

/** 退出登录。 */
export async function providerLogout(provider: ProviderId): Promise<boolean> {
  const answer = await askProvider<boolean>(provider, 'logout')
  if (answer.ok) return answer.value === true
  warnChannel(provider, 'logout', answer.why)
  return false
}

/** 网易云的手机号登录。密码只在这一个调用里出现，不落日志。 */
export async function providerLoginCellphone<T>(
  provider: ProviderId,
  phone: string,
  password: string,
  failed: T
): Promise<T> {
  const answer = await askProvider<T>(provider, 'loginCellphone', { phone, password })
  if (answer.ok) return answer.value
  warnChannel(provider, 'loginCellphone', answer.why)
  return failed
}
/** 关注的艺人。展示型读取：读不到就是空的，与收藏专辑同一条规矩。 */
export async function providerFollowedArtists<T>(provider: ProviderId, limit?: number): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'followedArtists', { limit })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'followedArtists', answer.why)
  return []
}

/*
 * 音质档位是本地偏好，不在上游：主进程读写的都是 settings.json。
 *
 * 读不到返回 null，界面沿用上一档而不是跳回最低档——「没问到」不等于「你没有
 * 无损权限」。写失败也返回 null，调用方据此知道刚才那次切换没有落地。
 */
export async function providerQuality<T>(provider: ProviderId): Promise<T | null> {
  const answer = await askProvider<T>(provider, 'qualityGet')
  if (answer.ok) return answer.value ?? null
  warnChannel(provider, 'qualityGet', answer.why)
  return null
}

export async function providerSetQuality<T>(provider: ProviderId, quality: string): Promise<T | null> {
  const answer = await askProvider<T>(provider, 'qualitySet', { quality })
  if (answer.ok) return answer.value ?? null
  warnChannel(provider, 'qualitySet', answer.why)
  return null
}

/** 切账号档案时把在线会话一并切过去。返回是否切成功。 */
export async function providerSetProfile(provider: ProviderId, profileId: string): Promise<boolean> {
  const answer = await askProvider<boolean>(provider, 'setProfile', { profileId })
  if (answer.ok) return answer.value === true
  warnChannel(provider, 'setProfile', answer.why)
  return false
}

