import { useSyncExternalStore } from 'react'
import type { RoamTaste } from './roam-pure'

/**
 * 漫游取用哪种偏好。
 *
 * 与「推荐来源」那一份同一个存法：放在这台机器的 localStorage 里，不跟着档案走。
 * 它记的是「现在想听什么口味」，不是某个人的身份。
 *
 * 三种模式都只吃各家的私人漫游——差别在拿到那批歌之后怎么挑，不在向平台要
 * 什么。平台的算法模式是服务端参数，Aurora 调不到，这一点在设置与 README 里
 * 都写明，不让人误以为换了模式就会换一批歌。
 */

type RoamMode = RoamTaste

interface RoamModeInfo {
  id: RoamMode
  name: string
  hint: string
}

export const ROAM_MODES: readonly RoamModeInfo[] = [
  { id: 'default', name: '默认', hint: '私人漫游推什么就放什么' },
  { id: 'familiar', name: '熟悉', hint: '先放认得的人与专辑' },
  { id: 'explore', name: '探索', hint: '先放不认识的，同一个人不连着出' }
]

const KEY = 'aurora.roam.mode'

const listeners = new Set<() => void>()

/**
 * 缓存一份：useSyncExternalStore 每帧都要一次快照，每次都读 localStorage 会
 * 让 React 认为状态一直在变。
 */
let snapshot: RoamMode | null = null

function isMode(value: unknown): value is RoamMode {
  return value === 'default' || value === 'familiar' || value === 'explore'
}

function read(): RoamMode {
  if (snapshot) return snapshot
  try {
    const raw = localStorage.getItem(KEY)
    snapshot = isMode(raw) ? raw : 'default'
  } catch {
    snapshot = 'default'
  }
  return snapshot
}

export function roamMode(): RoamMode {
  return read()
}

export function setRoamMode(mode: RoamMode): void {
  snapshot = mode
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // 存不住就只在这次会话里生效，不该因此让切换失败。
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useRoamMode(): RoamMode {
  return useSyncExternalStore(subscribe, read, read)
}
