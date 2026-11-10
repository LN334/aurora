import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useRoamPlatforms } from '../player/roam-sources'
import { usePushSignedOnly } from '../settings/push-signed'
import { listProviders } from './registry'
import { useOnlineStore } from './store'
import type { ProviderId } from './types'

/**
 * 推送位问哪几家：勾着的，加上「这一家现在登录着」——除非用户自己放开了。
 *
 * 两道条件的含义不一样。勾选是用户的意思——「别拿它推给我」；登录是能不能——
 * 没登录的平台给不出「给你的推荐」，只会拿公开榜单顶上（QQ 的今日私享要账号，
 * 网易云的私人漫游要账号，汽水的 feed 要 session）。默认两个都满足才问，推荐位
 * 才不会把游客也看得到的榜单冒充成个人推荐。
 *
 * 但这是用户的判断，不是我们替他定：设置里那句「只用我登录了的平台」关掉之后，
 * 没登录的平台照旧参与，只是内容退化成公开榜单。
 *
 * 「没登录」只影响推送位。搜索、播放、收藏都不看这个判断：那些事游客也能做。
 */

/** 各平台问过没有、登没登录，合成一份快照。 */
interface SignState {
  /** 快照键：平台 id 后面跟 +（登录）/ -（没登录）/ ?（还没问过）。 */
  key: string
  signed: ProviderId[]
  unknown: ProviderId[]
}

let snapshot: SignState | null = null

function read(): SignState {
  const parts: string[] = []
  const signed: ProviderId[] = []
  const unknown: ProviderId[] = []
  for (const provider of listProviders()) {
    const state = useOnlineStore(provider.id).getState()
    /*
     * ready 与 backendBlocked 都由 init 写：一个说「问通了」，一个说「这个构建
     * 没有它的后端」。两者都没动过，就是还没问过——此刻不能断言「没登录」，
     * 否则首屏会先把这一家滤掉、等 init 回来再补，推荐位先空一次再满。
     */
    const asked = state.ready || state.backendBlocked
    if (!asked) unknown.push(provider.id)
    if (state.account) signed.push(provider.id)
    parts.push(provider.id + (state.account ? '+' : asked ? '-' : '?'))
  }
  const key = parts.join(',')
  if (snapshot?.key !== key) snapshot = { key, signed, unknown }
  return snapshot ?? { key, signed, unknown }
}

function subscribe(listener: () => void): () => void {
  const stops = listProviders().map((provider) => useOnlineStore(provider.id).subscribe(listener))
  return () => {
    for (const stop of stops) stop()
  }
}

/**
 * 等这么久还没问出结果，就先当成能推。
 *
 * 平台初始化是网络活：冷启动、代理抖动、上游限流都可能让某一家久等不回。这
 * 时候一直把整块推荐挂空，用户看到的就不是「那一家没登录」，而是「推荐坏了」。
 * 问不出来不等于不能用，放行比挂住好。
 */
const GIVE_UP_MS = 3000

/**
 * 推送位该问的平台。
 *
 * 返回 null 表示还有平台没问完、结论未定：调用方此时应停在加载态，别先画一版
 * 再收紧（那会看起来像内容在换）。
 */
export function usePushPlatforms(): ProviderId[] | null {
  const chosen = useRoamPlatforms()
  const signedOnly = usePushSignedOnly()
  const sign = useSyncExternalStore(subscribe, read, read)
  const [late, setLate] = useState(false)

  /*
   * 有平台还没问过就去问。
   *
   * 日志页、搜索页都会用到各自平台，但推送位不能指望别人先 init：QQ 与汽水
   * 平时不进首页，它们的 store 可能一直是空的，那样「登录着没有」永远没有答案，
   * 只能靠超时放行，等于这道判断不存在。init 是单飞且幂等的，这里主动踢一脚。
   */
  useEffect(() => {
    if (!signedOnly) return
    const pending = listProviders()
      .filter((provider) => {
        const state = useOnlineStore(provider.id).getState()
        return !state.ready && !state.backendBlocked
      })
      .map((provider) => provider.id)
    if (pending.length === 0) return
    for (const id of pending) void useOnlineStore(id).getState().init().catch(() => {})
  }, [signedOnly])

  useEffect(() => {
    if (sign.unknown.length === 0) return
    const timer = window.setTimeout(() => setLate(true), GIVE_UP_MS)
    return () => window.clearTimeout(timer)
  }, [sign.key, sign.unknown.length])

  const chosenKey = chosen.join(',')
  return useMemo(() => {
    // 用户放开了：勾着谁就问谁，没登录也照问，取回来的会是公开榜单。
    if (!signedOnly) return chosen
    if (sign.unknown.length > 0 && !late) return null
    const allowed = new Set<ProviderId>(sign.signed)
    if (late) for (const id of sign.unknown) allowed.add(id)
    return chosen.filter((id) => allowed.has(id))
    // 数组每份快照都是新的，用 join 后的字符串与快照键当依赖。
  }, [chosenKey, sign.key, late, signedOnly])
}
