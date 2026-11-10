/**
 * 这些平台是不是都已经回答过一次了。
 *
 * 引导第一屏要一次就画成最终样子：登录状态没问回来之前先摆一行「登录」按钮、
 * 半秒后换成昵称，那一瞬间在遮罩上看着就是闪。所以先把状态问齐再露面，最多等
 * `timeoutMs`——网络卡住时宁可早一点显示，也不能让引导一直不出来。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useOnlineStore } from './store'
import type { ProviderId } from './types'

export function useProvidersSettled(ids: ProviderId[], timeoutMs = 1200): boolean {
  const key = ids.join(',')
  const answered = useSyncExternalStore(
    (notify) => {
      const offs = ids.map((id) => useOnlineStore(id).subscribe(notify))
      return () => {
        for (const off of offs) off()
      }
    },
    () =>
      ids.every((id) => {
        const state = useOnlineStore(id).getState()
        return state.ready || state.backendBlocked
      }),
    () => false
  )

  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    setTimedOut(false)
    const timer = window.setTimeout(() => setTimedOut(true), timeoutMs)
    return () => window.clearTimeout(timer)
  }, [key, timeoutMs])

  return answered || timedOut
}
