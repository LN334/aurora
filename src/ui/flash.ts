import { create } from 'zustand'

/**
 * 一次性的页面提示（顶部一条）。
 *
 * 原来是 App 里的一个 useState，够用是因为只有 App 自己会说话。喜欢/取消喜欢
 * 是列表行里的动作，失败时也必须说一句——用户明确要求过「点了不能没变化」——
 * 所以提示提到一个全应用共享的槽位，谁都能往里放一句。
 */

interface FlashState {
  message: string | null
  show(message: string | null): void
}

/** 自动收起的时间。够读完一句短话，又不至于永远挂在页面上。 */
const HOLD_MS = 4500

let timer: ReturnType<typeof setTimeout> | null = null

export const useFlash = create<FlashState>()((set) => ({
  message: null,

  show(message) {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    set({ message })
    if (!message) return
    timer = setTimeout(() => {
      timer = null
      set({ message: null })
    }, HOLD_MS)
  }
}))

/** 从任意模块说一句话。 */
export function showFlash(message: string): void {
  useFlash.getState().show(message)
}
