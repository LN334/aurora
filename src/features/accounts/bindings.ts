import { useEffect, useState } from 'react'
import { isNative } from '../../bridge'
import type { NeteaseAccount } from '../../env'
import { netease } from '../netease/api'
import type { Account } from './store'

/**
 * 每个本地档案当前绑着的网易云账号。
 *
 * 以前只有档案页需要它，所以写在那个组件里；现在侧栏底部的档案入口也要显示
 * 同一个头像，两处各问一次会得到两个可能不同步的答案，抽出来共用。
 *
 * 只在有主进程（Electron）时问：浏览器预览里 netease.accountFor 不存在。
 */
export function useOnlineBindings(
  accounts: Account[]
): Record<string, NeteaseAccount | null> {
  const [bindings, setBindings] = useState<Record<string, NeteaseAccount | null>>({})

  useEffect(() => {
    if (!isNative || !netease.accountFor) return
    let cancelled = false
    void (async () => {
      const next: Record<string, NeteaseAccount | null> = {}
      for (const account of accounts) {
        next[account.id] = await netease.accountFor(account.id)
      }
      if (!cancelled) setBindings(next)
    })()
    return () => {
      cancelled = true
    }
  }, [accounts])

  return bindings
}
