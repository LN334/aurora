import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * 按住拖动来滑动一块可滚区域。
 *
 * 聊天室与日志窗都把滚动条藏起来了（一条竖线在那种窗口里比内容更显眼），
 * 但滚轮之外还得留一个看得见手势的操作，否则内容一多就只好像「滑不动」。
 *
 * 轻点一下不动仍然可以选字复制：只有真的拖出 3px 才吃掉选择。
 */
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const drag = useRef({ y: 0, top: 0, on: false })

  const onPointerDown = (event: ReactPointerEvent<T>): void => {
    const el = ref.current
    if (!el) return
    drag.current = { y: event.clientY, top: el.scrollTop, on: true }
    el.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<T>): void => {
    const el = ref.current
    if (!el || !drag.current.on) return
    const moved = event.clientY - drag.current.y
    if (Math.abs(moved) < 3) return
    el.style.userSelect = 'none'
    el.scrollTop = drag.current.top - moved
  }

  const release = (): void => {
    drag.current.on = false
    if (ref.current) ref.current.style.userSelect = ''
  }

  return {
    ref,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: release,
      onPointerCancel: release
    }
  }
}
