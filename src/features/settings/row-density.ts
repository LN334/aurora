import { useSyncExternalStore } from 'react'

/*
 * 列表行密度。
 *
 * 只调主列表（.trk）：库里的歌、搜索结果、队列、歌单曲目都是它。
 * 歌单详情里那种更小的一行（.pl-track）不跟着变——它本来就是紧凑的索引行。
 *
 * 值走 --row-h-trk：app.css 里 .trk 那组原本把 --row-h 写死成 60，
 * 现在读这个带默认值的变量，没设过就是原样。
 */

const KEY = 'aurora.rows.density'

interface RowDensity {
  id: 'compact' | 'cozy' | 'loose'
  name: string
  h: number
}

export const ROW_DENSITIES: RowDensity[] = [
  { id: 'compact', name: '紧凑', h: 46 },
  { id: 'cozy', name: '标准', h: 60 },
  { id: 'loose', name: '宽松', h: 76 },
]

const DEFAULT = 'cozy'

let snapshot: RowDensity | null = null
let snapshotKey: string | null = null
const listeners = new Set<() => void>()

function fromId(id: string | null): RowDensity {
  return ROW_DENSITIES.find((item) => item.id === id) ?? ROW_DENSITIES[1]
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readRowDensity(): RowDensity {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  const key = raw === null || raw === '' ? DEFAULT : raw
  if (key !== snapshotKey || snapshot === null) {
    snapshotKey = key
    snapshot = fromId(key)
  }
  return snapshot
}

export function applyRowDensity(density: RowDensity): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--row-h-trk', density.h + 'px')
}

export function writeRowDensity(id: RowDensity['id']): void {
  const density = fromId(id)
  try {
    localStorage.setItem(KEY, density.id)
  } catch {
    // 存储被禁用时仍然让本次会话生效，只是记不住。
  }
  snapshotKey = density.id
  snapshot = density
  applyRowDensity(density)
  for (const listener of listeners) listener()
}

export function useRowDensity(): RowDensity {
  return useSyncExternalStore(subscribe, readRowDensity, readRowDensity)
}
