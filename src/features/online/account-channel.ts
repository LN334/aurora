import type { ProviderId } from './types.ts'

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

type Answer<T> = { ok: true; value: T } | { ok: false; why: string }

async function ask<T>(provider: ProviderId, capability: string, args?: unknown): Promise<Answer<T>> {
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

function warn(provider: ProviderId, capability: string, why: string): void {
  console.warn(`[aurora] ${provider}.${capability} 未走通：${why}`)
}

/** 平台是否就绪、是否已登录。失败时 null（「没问到」），调用方按未就绪处理。 */
export async function providerStatus<T>(provider: ProviderId): Promise<T | null> {
  const answer = await ask<T>(provider, 'status')
  if (answer.ok) return answer.value
  warn(provider, 'status', answer.why)
  return null
}

/** 当前登录的账号，没登录就是 null。 */
export async function providerLoginStatus<T>(provider: ProviderId): Promise<T | null> {
  const answer = await ask<T>(provider, 'loginStatus')
  if (answer.ok) return answer.value
  warn(provider, 'loginStatus', answer.why)
  return null
}

/** 某个档案绑着的账号，档案页用。 */
export async function providerAccountFor<T>(
  provider: ProviderId,
  profileId: string
): Promise<T | null> {
  const answer = await ask<T>(provider, 'accountFor', { profileId })
  if (answer.ok) return answer.value
  warn(provider, 'accountFor', answer.why)
  return null
}

/** 让某个档案退出登录。 */
export async function providerLogoutProfile(
  provider: ProviderId,
  profileId: string
): Promise<boolean> {
  const answer = await ask<boolean>(provider, 'logoutProfile', { profileId })
  if (answer.ok) return answer.value === true
  warn(provider, 'logoutProfile', answer.why)
  return false
}

/** 要一张新二维码。`empty` 是拿不到时的形状，与主进程的兜底一致。 */
export async function providerQrCreate<T>(provider: ProviderId, empty: T): Promise<T> {
  const answer = await ask<T>(provider, 'qrCreate')
  if (answer.ok) return answer.value
  warn(provider, 'qrCreate', answer.why)
  return empty
}

/** 轮询一次二维码。`failed` 是查询本身没走通时的形状。 */
export async function providerQrCheck<T>(
  provider: ProviderId,
  key: string,
  failed: T
): Promise<T> {
  const answer = await ask<T>(provider, 'qrCheck', { key })
  if (answer.ok) return answer.value
  warn(provider, 'qrCheck', answer.why)
  return failed
}

/** 退出登录。 */
export async function providerLogout(provider: ProviderId): Promise<boolean> {
  const answer = await ask<boolean>(provider, 'logout')
  if (answer.ok) return answer.value === true
  warn(provider, 'logout', answer.why)
  return false
}

/** 网易云的手机号登录。密码只在这一个调用里出现，不落日志。 */
export async function providerLoginCellphone<T>(
  provider: ProviderId,
  phone: string,
  password: string,
  failed: T
): Promise<T> {
  const answer = await ask<T>(provider, 'loginCellphone', { phone, password })
  if (answer.ok) return answer.value
  warn(provider, 'loginCellphone', answer.why)
  return failed
}
