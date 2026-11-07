import { useSyncExternalStore } from 'react'

/**
 * 界面颜色是否跟着正在播的封面走。
 *
 * tokens.css 的设定是「外壳自己不带颜色」：唯一的彩色值 --accent 由封面取色
 * 每次换歌覆盖。这套在纯色背景下很好看，但一旦打开 Wallpaper Engine 的动态
 * 背景，画面本身已经很热闹，再叠一层随封面变化的强调色就会出现用户说过的
 * 「壁纸和背景色冲突」——两种彩色在抢同一块视觉。
 *
 * 关掉之后 --accent 退回 tokens.css 里的冷灰，界面只剩壁纸一种颜色，
 * 文字对比度也稳定下来。默认开，因为绝大多数时候没有壁纸。
 *
 * 存 localStorage：它只影响渲染层，不改变文件或账号状态。
 */

const STORAGE_KEY = 'aurora.accentFromArt'

const listeners = new Set<() => void>()
let current: boolean = read()

function read(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    // 没存过就是默认开；只有明确写了 'off' 才关。
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function accentFromArt(): boolean {
  return current
}

export function setAccentFromArt(next: boolean): void {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
  } catch {
    /* 存不进去就只在这次会话里生效。 */
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAccentFromArt(): boolean {
  return useSyncExternalStore(subscribe, accentFromArt, accentFromArt)
}
