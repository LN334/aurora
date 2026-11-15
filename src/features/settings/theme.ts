import { useSyncExternalStore } from 'react'

/*
 * 主题：跟随系统 / 深色 / 浅色。
 *
 * 真正的开关是 <html data-theme>，颜色全在 tokens.css 里分两套写着；这里只管
 * 三件事——把选择记进 localStorage、写 data-theme、以及在「跟随系统」时听
 * Windows 那边的明暗切换。
 *
 * React 起来之前没有别的脚本读这个键了（boot.js 随开屏一起删掉了），首帧由
 * main.tsx 在 render 之前调用 applyTheme；窗口底色则由主进程按系统主题铺。
 */

const KEY = 'aurora.theme'
const QUERY = '(prefers-color-scheme: light)'

interface ThemeOption {
  id: 'system' | 'dark' | 'light'
  name: string
}

export const THEMES: ThemeOption[] = [
  { id: 'system', name: '跟随系统' },
  { id: 'dark', name: '深色' },
  { id: 'light', name: '浅色' }
]

let snapshot: ThemeOption | null = null
let snapshotKey: string | null = null
const listeners = new Set<() => void>()

function fromId(id: string | null): ThemeOption {
  return THEMES.find((item) => item.id === id) ?? THEMES[0]
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readTheme(): ThemeOption {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  const key = raw === null || raw === '' ? 'system' : raw
  if (key !== snapshotKey || snapshot === null) {
    snapshotKey = key
    snapshot = fromId(key)
  }
  return snapshot
}

/* 系统那边现在是亮还是暗。只在「跟随系统」时有意义。 */
function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(QUERY).matches
}

export function applyTheme(choice: ThemeOption = readTheme()): void {
  if (typeof document === 'undefined') return
  const light = choice.id === 'light' || (choice.id === 'system' && systemPrefersLight())
  document.documentElement.dataset.theme = light ? 'light' : 'dark'
}

export function writeTheme(id: ThemeOption['id']): void {
  const choice = fromId(id)
  try {
    localStorage.setItem(KEY, choice.id)
  } catch {
    // 存储被禁用时仍然让本次会话生效，只是记不住。
  }
  snapshotKey = choice.id
  snapshot = choice
  applyTheme(choice)
  for (const listener of listeners) listener()
}

export function useTheme(): ThemeOption {
  return useSyncExternalStore(subscribe, readTheme, readTheme)
}

/*
 * 跟着系统一起翻。只监听一次，而且只在自己被选成「跟随系统」时动手——
 * 手动选了深色的人不该被系统设置拽走。
 */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia(QUERY).addEventListener('change', () => {
    if (readTheme().id === 'system') applyTheme()
  })
}