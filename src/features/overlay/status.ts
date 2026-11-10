import { useEffect, useState } from 'react'
import { bridge, isNative } from '../../bridge'
import type { OverlayStatus } from '../../env'

/**
 * 桌面歌词窗口的当前状态。
 *
 * 状态归主进程：这个窗口能从设置页、托盘、快捷键几个地方开合，页面这边
 * 只把它报回来的值画出来，不做本地猜测。网页里跑（非桌面版）永远是 null。
 */
export function useOverlayStatus(): OverlayStatus | null {
  const [status, setStatus] = useState<OverlayStatus | null>(null)

  useEffect(() => {
    if (!isNative) return
    let alive = true
    void bridge.overlay
      .getStatus()
      .then((next) => {
        if (alive) setStatus(next)
      })
      .catch(() => {})
    const off = bridge.overlay.onStatus((next) => setStatus(next))
    return () => {
      alive = false
      off()
    }
  }, [])

  return status
}
