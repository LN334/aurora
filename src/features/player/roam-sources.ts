import { useSyncExternalStore } from 'react'
import { listAvailableProviders } from '../online/registry'
import type { ProviderId } from '../online/types'

/**
 * 推荐问哪几家。
 *
 * 每家的推荐能力不一样：网易云有私人漫游，酷狗每天给三十首，QQ 的每日推荐要真
 * 账号而且常常是空，汽水的 feed 还在等账号体系。所以把平台交给用户自己勾——
 * 勾了但上游没给，页面会说「这一家今天没推」，而不是让人以为推荐坏了。
 *
 * 这一份选择同时管三处：漫游、首页那块「今天听什么」、每日推荐页。设置里改的
 * 就是它，所以别在别处再存一份。
 */
const KEY = 'aurora.roam.platforms'

const listeners = new Set<() => void>()
let snapshot: ProviderId[] | null = null
let snapshotKey = ''

/** 有推荐能力的平台，按注册顺序。 */
export function roamCandidates(): { id: ProviderId; name: string }[] {
  return listAvailableProviders()
    .filter((provider) =>
      Boolean(provider.recommendations?.personalFm || provider.recommendations?.dailySongs)
    )
    .map((provider) => ({ id: provider.id, name: provider.displayName }))
}

function stored(): ProviderId[] | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((item): item is ProviderId => typeof item === 'string')
  } catch {
    return null
  }
}

function read(): ProviderId[] {
  const all = roamCandidates().map((item) => item.id)
  const saved = stored()
  // 没存过就是全选；存过但某家已经装不上了，就按装的来。
  const value = saved === null ? all : saved.filter((id) => all.includes(id))
  const key = value.join(',')
  if (key !== snapshotKey) {
    snapshotKey = key
    snapshot = value
  }
  return snapshot ?? value
}

/** 当前勾着的平台。空数组是「一家都没勾」，不是「全选」。 */
export function roamPlatforms(): ProviderId[] {
  return read()
}

export function setRoamPlatform(id: ProviderId, on: boolean): void {
  const next = new Set(read())
  if (on) next.add(id)
  else next.delete(id)
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    return
  }
  snapshotKey = ''
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useRoamPlatforms(): ProviderId[] {
  return useSyncExternalStore(subscribe, read, read)
}
