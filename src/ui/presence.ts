import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 让「关掉了」和「已经不见了」分开。
 *
 * 调用方一心想让东西消失，直接 `if (!open) return null` 的结果是：关闭那一刻
 * 元素被整个摘掉，正在播的退场动画根本没机会跑，于是所有面板都是「一帧消失」。
 * 这个钩子把 open 的下降沿延后一个动画时长：先挂着 closing 让样式放一段退场，
 * 时间到了才真的卸载。
 *
 * 时长要和 CSS 里那条退场动画一致。prefers-reduced-motion 下样式里的时长会被
 * 令牌压到 1ms，但这里的定时器仍按原值走——多等几百毫秒看不见任何东西，比
 * 「动画没了但元素赖着不走」安全。
 */
export function usePresence(open: boolean, ms: number): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setMounted(false)
      setClosing(false)
    }, Math.max(1, ms))
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [open, mounted, ms])

  return { mounted, closing }
}

/**
 * 把「请求关闭」推迟一个动画时长。
 *
 * 弹窗和菜单的关闭原本只有一条路：调用方 setState(null)，组件随即被卸载。它们
 * 没有 open 这个 prop，也不该为了动画让每个调用点都改成常驻挂载，所以改成在
 * 组件内部留一个离开态——先挂上 is-closing 放出退场，再真正调用 onClose。
 */
export function useLeave(ms: number): {
  leaving: boolean
  leave: (done: () => void) => void
} {
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  const leave = useCallback(
    (done: () => void) => {
      if (timer.current !== null) return
      setLeaving(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        done()
      }, Math.max(1, ms))
    },
    [ms]
  )

  return { leaving, leave }
}
