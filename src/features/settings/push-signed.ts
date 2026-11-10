import { useSyncExternalStore } from 'react'

/**
 * 推送位要不要把没登录的平台也算进来。
 *
 * 默认只管登录着的平台。理由不是技术上的：没登录时平台给的是公开榜单，不是
 * 「给你的推荐」，把榜单混进推荐位，用户会以为自己被推了这些歌。但公开榜单也
 * 不是没价值（网易云的热歌榜、酷狗的榜单本来就图一乐），所以留成一个开关——
 * 关掉它，没登录的平台照旧参与，内容退化成榜单，用户心里有数。
 *
 * 存在 localStorage：这只影响渲染进程问哪几家，主进程一处都用不上。读写方式与
 * `home-sections.ts` 同一套，设置页与取数钩子共享同一份快照。
 */
const KEY = 'aurora.push.signedOnly'

let snapshot: boolean | null = null
/* 初值给 null 而不是空串：空串恰好等于「没存过」，那样默认值就读不出来。 */
let snapshotKey: string | null = null
const listeners = new Set<() => void>()

function rawValue(): string {
  try {
    return window.localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

function read(): boolean {
  const raw = rawValue()
  if (raw !== snapshotKey) {
    snapshotKey = raw
    snapshot = raw === '' ? true : raw === '1'
  }
  return snapshot ?? true
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePushSignedOnly(): boolean {
  return useSyncExternalStore(subscribe, read, read)
}

export function setPushSignedOnly(on: boolean): void {
  const raw = on ? '1' : '0'
  try {
    window.localStorage.setItem(KEY, raw)
  } catch {
    // 存不下也先把这一程改了，别让开关点了没反应。
  }
  snapshot = on
  snapshotKey = raw
  for (const listener of listeners) listener()
}
