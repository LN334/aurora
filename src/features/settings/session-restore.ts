import { useSyncExternalStore } from 'react'

/*
 * 启动时恢复上次的播放队列。
 *
 * 存的是「队列 + 当前是哪一首 + 随机顺序」，不存播放进度：恢复后停在 0:00
 * 等用户按播放，比从半截接上稳——音源可能已经换了一批，接着放容易撞上取不到流的歌。
 *
 * 关掉之后下一次写存档就不再带队列，重开就是干净的。
 */

const KEY = 'aurora.player.restore'
const DEFAULT = true

let snapshot: boolean | null = null
let snapshotKey: string | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readSessionRestore(): boolean {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  const key = raw ?? ''
  if (key !== snapshotKey || snapshot === null) {
    snapshotKey = key
    snapshot = key === '' ? DEFAULT : key === '1'
  }
  return snapshot
}

export function writeSessionRestore(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // 存储被禁用时仍然让本次会话生效，只是记不住。
  }
  snapshotKey = on ? '1' : '0'
  snapshot = on
  for (const listener of listeners) listener()
}

export function useSessionRestore(): boolean {
  return useSyncExternalStore(subscribe, readSessionRestore, readSessionRestore)
}
