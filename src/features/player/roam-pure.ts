import type { Track } from '../../types'
import { trackKey } from '../online/unify.ts'

/**
 * 漫游的纯算术：这一趟走到哪、还能接多少首。
 *
 * 放在这里而不是组件里，是因为这两件事都要在测试里算准：
 * 「已听几首」决定轨道上那行字，「还能接几首」决定尾巴卡写 +20 还是「已经到底」。
 */

export interface RoamProgress {
  /** 当前这首在这一趟里的位次；不在这一趟里就是 -1。 */
  index: number
  /** 这一趟一共多少首。 */
  total: number
  /** 已经听过多少首。 */
  heard: number
  /** 当前之后还有多少首没走。 */
  ahead: number
}

export function roamProgress(
  tracks: readonly Track[],
  current: Track | null,
  heard: ReadonlySet<string>
): RoamProgress {
  const total = tracks.length
  const index = current ? tracks.findIndex((track) => trackKey(track) === trackKey(current)) : -1
  let count = 0
  for (const track of tracks) {
    if (heard.has(trackKey(track))) count += 1
  }
  return { index, total, heard: count, ahead: index < 0 ? total : Math.max(0, total - index - 1) }
}

/**
 * 把新要到的一批接在旧列表后面。
 *
 * 三件事都在这里做：去掉列表里已有的（同一首在两家平台都有时 mergeVersions 已经
 * 并过一行，但两次请求之间平台会重复推）、去掉用户划掉过的、保持原来的先后。
 * 返回空数组就是「这批全是重复」，调用方该说一句话而不是默默不动。
 */
export function appendFresh(
  existing: readonly Track[],
  incoming: readonly Track[],
  hidden: ReadonlySet<string>
): Track[] {
  const seen = new Set(existing.map((track) => trackKey(track)))
  const out: Track[] = []
  for (const track of incoming) {
    const key = trackKey(track)
    if (seen.has(key) || hidden.has(key)) continue
    seen.add(key)
    out.push(track)
  }
  return out
}

/** 从这一趟里摘掉一首（划掉）。队列那边的摘除由调用方决定。 */
export function withoutTrack(tracks: readonly Track[], target: Track): Track[] {
  const key = trackKey(target)
  return tracks.filter((track) => trackKey(track) !== key)
}

/**
 * 快放到这一趟的尾巴了吗。
 *
 * 漫游不主动停止：剩下几首的时候就把下一批要过来，接在队列后面。留出这一段
 * 提前量是因为要歌要过网络——等到最后一首才开始要，中间会断一口气。
 * left 是「当前之后还有几首」；负数当作已经到了末尾。
 */
export function shouldPullMore(left: number, ahead: number): boolean {
  return left <= ahead
}
