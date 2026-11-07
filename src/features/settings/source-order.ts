import { useSyncExternalStore } from 'react'

/**
 * 用户设定的音源优先级。
 *
 * 存 localStorage 而不是主进程设置：它只影响渲染层的取流顺序，不改变任何文件
 * 或账号状态，而 localStorage 在刷新后仍在，也不会因为主进程设置数组多一项就
 * 需要迁移旧配置。
 *
 * 顺序的含义：同一首歌在几个平台上都有时，列表按这个顺序挑主行；播放时也按
 * 这个顺序找第一个能出流的版本。
 */

const STORAGE_KEY = 'aurora.sourceOrder'

/** 默认顺序：本机在前——它不需要联网，也不需要会员。 */
export const DEFAULT_ORDER = ['local', 'netease', 'qq', 'kugou']

const listeners = new Set<() => void>()
let current: string[] = read()

function read(): string[] {
  if (typeof localStorage === 'undefined') return [...DEFAULT_ORDER]
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULT_ORDER]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_ORDER]
    const values = parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
    // 已知平台按存下的顺序在前，未登记的平台补在后面，免得升级后少一段。
    const known = values.filter((id) => DEFAULT_ORDER.includes(id))
    const extra = DEFAULT_ORDER.filter((id) => !known.includes(id))
    return [...known, ...extra]
  } catch {
    return [...DEFAULT_ORDER]
  }
}

export function sourceOrder(): string[] {
  return current
}

export function setSourceOrder(order: string[]): void {
  const next = order.filter((id) => id.length > 0)
  if (next.join('|') === current.join('|')) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 存不进去就只在这一次会话里生效，不影响播放。 */
  }
  for (const listener of listeners) listener()
}

/** 把某个平台往上/下挪一位；到头就返回原顺序。 */
export function moveSource(id: string, delta: -1 | 1): string[] {
  const index = current.indexOf(id)
  if (index === -1) return current
  const target = index + delta
  if (target < 0 || target >= current.length) return current
  const next = [...current]
  const [item] = next.splice(index, 1)
  if (item) next.splice(target, 0, item)
  setSourceOrder(next)
  return next
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 渲染层用：设置一变，所有列表与播放器立刻按新顺序重排。 */
export function useSourceOrder(): string[] {
  return useSyncExternalStore(subscribe, sourceOrder, sourceOrder)
}
