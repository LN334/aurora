import { useSyncExternalStore } from 'react'

/**
 * 扩展开关的持久化。
 *
 * 只记「被关掉」的 id：没有记录就是启用，所以新增扩展默认是开的，也不必为了
 * 升级去迁移一份全量状态。存 localStorage 是因为它只影响界面，不碰文件或账号。
 */

const STORAGE_KEY = 'aurora.mods.disabled'

const listeners = new Set<() => void>()
let current: string[] = read()

function read(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 只认字符串：手改坏的 localStorage 不该让整页崩掉。
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/** 被关掉的扩展 id。默认空数组，即全部启用。 */
export function readDisabled(): string[] {
  return current
}

/** 写回整份关闭列表；内容没变就不通知，免得白白重渲染。 */
export function writeDisabled(ids: string[]): void {
  const next = Array.from(new Set(ids))
  if (next.length === current.length && next.every((id, index) => id === current[index])) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* 存不进去就只在这次会话里生效。 */
  }
  for (const listener of listeners) listener()
}

/** 打开或关闭一个扩展；on 为真表示启用。 */
export function setMod(id: string, on: boolean): void {
  if (on) {
    writeDisabled(current.filter((item) => item !== id))
    return
  }
  if (!current.includes(id)) writeDisabled([...current, id])
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 当前被关掉的扩展 id；页面按它算出每个开关的真实状态。 */
export function useModsEnabled(): string[] {
  return useSyncExternalStore(subscribe, readDisabled, readDisabled)
}
