import { useSyncExternalStore } from 'react'

/**
 * 第一次启动的那一遍设置。
 *
 * 只回答一个问题：这个人把推流来源挑过了吗。挑过就不再打扰；想再看一遍，
 * 设置 → 推荐来源里直接写回 false，覆盖层立刻回来。
 */
const KEY = 'aurora.onboarded'

let snapshot: boolean | null = null
let snapshotKey: string | null = null
const listeners = new Set<() => void>()

function read(): boolean {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  const key = raw ?? ''
  if (key !== snapshotKey) {
    // 键初值必须是 null 而不是 ''：空串恰好等于「没有存过」的键，会永远不重建快照。
    snapshotKey = key
    snapshot = key === '1'
  }
  return snapshot ?? false
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useOnboarded(): boolean {
  return useSyncExternalStore(subscribe, read, read)
}

export function setOnboarded(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // 存不进去就这一轮先当看过了，下次启动再问。
  }
  snapshot = null
  snapshotKey = null
  for (const listener of listeners) listener()
}
