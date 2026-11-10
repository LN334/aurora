import { useSyncExternalStore } from 'react'

/**
 * 首页上那几块推荐摆不摆出来。
 *
 * 存在 localStorage 而不是走主进程的 settings：这几个开关只影响渲染进程怎么排
 * 首页，主进程一处都用不上，多开一条 IPC 只是多一份要维护的镜像。读写方式与
 * `features/player/roam-sources.ts` 同一套，设置页与首页共享同一份快照。
 */
type HomeSectionId = 'playlists' | 'albums' | 'fresh' | 'recent'

interface HomeSection {
  id: HomeSectionId
  name: string
  hint: string
}

export const HOME_SECTIONS: HomeSection[] = [
  { id: 'playlists', name: '推荐歌单', hint: '四家平台各推一批，混成一排，能换批。' },
  { id: 'albums', name: '推荐专辑', hint: '一行横条，左右能翻。' },
  { id: 'fresh', name: '最近新歌', hint: '左边一张主推，右边一列刚到的新歌。' },
  { id: 'recent', name: '最近听过', hint: '自己放过的最后八首，带相对时间。' }
]

const KEY = 'aurora.home.sections'

type HomeSections = Record<HomeSectionId, boolean>

const DEFAULTS: HomeSections = { playlists: true, albums: true, fresh: true, recent: true }

let snapshot: HomeSections | null = null
/* 初值给 null 而不是空串：空串恰好等于「没存过」的 raw，那样空配置就读不出快照。 */
let snapshotKey: string | null = null
const listeners = new Set<() => void>()

function rawValue(): string {
  try {
    return window.localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

function parse(raw: string): HomeSections {
  const value: HomeSections = { ...DEFAULTS }
  if (!raw) return value
  try {
    const parsed = JSON.parse(raw) as Partial<Record<HomeSectionId, boolean>>
    for (const item of HOME_SECTIONS) {
      const on = parsed[item.id]
      if (typeof on === 'boolean') value[item.id] = on
    }
  } catch {
    // 坏值就当没设过：少一个开关不影响播放。
  }
  return value
}

function read(): HomeSections {
  const raw = rawValue()
  if (!snapshot || raw !== snapshotKey) {
    snapshot = parse(raw)
    snapshotKey = raw
  }
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHomeSections(): HomeSections {
  return useSyncExternalStore(subscribe, read, read)
}

export function setHomeSection(id: HomeSectionId, on: boolean): void {
  const next = { ...read(), [id]: on }
  let raw = ''
  try {
    raw = JSON.stringify(next)
    window.localStorage.setItem(KEY, raw)
  } catch {
    // 存不下也先把这一程的界面改了，别让开关点了没反应。
  }
  snapshot = next
  snapshotKey = raw
  for (const listener of listeners) listener()
}
