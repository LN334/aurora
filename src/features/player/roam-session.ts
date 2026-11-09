import { create } from 'zustand'
import type { Track } from '../../types'
import { SLOTS } from '../online/slots'
import { trackKey } from '../online/unify'
import { player } from './actions'
import { appendFresh, roamProgress, type RoamProgress, withoutTrack } from './roam-pure'
import { buildRoamQueue, loadRoamPool, loadRoamStream } from './roam'
import { roamPlatforms } from './roam-sources'
import { usePlayer } from './store'

/**
 * 一趟漫游。
 *
 * 漫游不是一个页面，是一次播放会话：左栏点它就换掉队列开始放，播放页底下长出
 * 一条轨道。所以这一份状态必须活得比任何页面久，放在 store 里；页面组件只读它。
 *
 * 三件事刻意分开：
 *
 * 1. `tracks` 是这一趟的全部候选，只增不减，除了被划掉的那首。
 * 2. 播放队列是 `tracks` 的一份拷贝（可能顺序不同、可能被别的操作插过歌）。
 *    两者用 `trackKey` 对上，不靠数组下标——下标会被 shuffle 和插队打乱。
 * 3. `heard` 记录这一趟里听过哪些。它不是播放历史，只服务「已听 6 / 60」这行字
 *    与「接着上次听」的落点。
 */

/** 划掉过的歌。会话结束后仍然不算漫游——同一个推荐反复出现正是漫游最烦的事。 */
const HIDE_KEY = 'aurora.roam.hidden'

/** 划掉列表的上限。推荐流是长期的，不封顶会一直长。 */
const HIDE_LIMIT = 300

function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

function writeHidden(hidden: Set<string>): void {
  try {
    const kept = [...hidden].slice(-HIDE_LIMIT)
    localStorage.setItem(HIDE_KEY, JSON.stringify(kept))
  } catch {
    // 存不进去就只在这次会话里有效，不该因此让划掉这个动作失败。
  }
}

export interface RoamState {
  tracks: Track[]
  heard: Record<string, true>
  /** 正在向平台要第一趟。 */
  busy: boolean
  /** 正在往后接一批。 */
  pulling: boolean
  /** 要不到时的一句话，显示在左栏按钮下面。 */
  error: string
}

export const useRoam = create<RoamState>()(() => ({
  tracks: [],
  heard: {},
  busy: false,
  pulling: false,
  error: ''
}))

/** 当前这首在不在这趟里。不在就不该显示漫游那套东西。 */
export function isRoamTrack(track: Track | null): boolean {
  if (!track) return false
  const key = trackKey(track)
  return useRoam.getState().tracks.some((item) => trackKey(item) === key)
}

export function useRoamProgress(current: Track | null): RoamProgress {
  const tracks = useRoam((state) => state.tracks)
  const heard = useRoam((state) => state.heard)
  const keys = new Set(Object.keys(heard))
  return roamProgress(tracks, current, keys)
}

/**
 * 点「漫游」。
 *
 * 有这一趟就接着听：先找第一首没听过的。没有就现要一趟。返回 true 表示队列已经
 * 换好，调用方可以进播放页；false 表示这次没成，原因写在 error 里。
 */
export async function startRoam(): Promise<boolean> {
  const state = useRoam.getState()
  if (state.busy) return false

  const current = usePlayer.getState().current()
  if (state.tracks.length > 0) {
    // 这一趟还在：从第一首没听过的接着放。全都听过就从头再来一遍。
    if (current && isRoamTrack(current)) return true
    const heard = state.heard
    // 从头找第一首没听过的；全都听过就回到第一首，这趟再来一遍。
    const at = state.tracks.findIndex((track) => !heard[trackKey(track)])
    player.playQueue(state.tracks, at >= 0 ? at : 0)
    return true
  }

  useRoam.setState({ busy: true, error: '' })
  try {
    const pool = await loadRoamPool(roamPlatforms())
    const hidden = readHidden()
    const tracks = buildRoamQueue(pool).filter((track) => !hidden.has(trackKey(track)))
    if (tracks.length === 0) {
      useRoam.setState({ busy: false, error: '这几家今天还没推过来，换几家或过会儿再试' })
      return false
    }
    useRoam.setState({ tracks, heard: {}, busy: false, pulling: false, error: '' })
    player.playQueue(tracks, 0)
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    useRoam.setState({ busy: false, error: '这一趟没要到：' + reason })
    return false
  }
}

/**
 * 往后接一批。
 *
 * 列表与队列一起长：只长列表的话点尾巴卡会从头重放，只长队列的话轨道上看不到。
 * 正在放的这首不打断。
 */
export async function pullRoamMore(): Promise<void> {
  const state = useRoam.getState()
  if (state.pulling) return
  useRoam.setState({ pulling: true, error: '' })
  try {
    const more = await loadRoamStream(Math.ceil(SLOTS.roam / 2))
    const fresh = appendFresh(useRoam.getState().tracks, more, readHidden())
    if (fresh.length === 0) {
      useRoam.setState({ pulling: false, error: '平台这批和手上重复了，过一会儿再要' })
      return
    }
    useRoam.setState((prev) => ({ tracks: [...prev.tracks, ...fresh], pulling: false }))
    player.addToQueue(fresh, 'end')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    useRoam.setState({ pulling: false, error: '这批没要到：' + reason })
  }
}

/**
 * 划掉这首。
 *
 * 两件事同时做：从这一趟里拿掉（轨道上立刻消失），记进划掉名单（下次要歌时不再
 * 出现）。正在放的就是它，就跳下一首——否则卡片没了歌还在响，看起来像没生效。
 */
export function hideRoamTrack(track: Track): void {
  const hidden = readHidden()
  hidden.add(trackKey(track))
  writeHidden(hidden)
  useRoam.setState((prev) => ({ tracks: withoutTrack(prev.tracks, track) }))
  // 队列里也摘掉：只从轨道上拿走的话，放到它时还会响，看起来像划掉没生效。
  const at = usePlayer.getState().queue.findIndex((item) => trackKey(item) === trackKey(track))
  if (at >= 0) player.removeFromQueue(at)
}

/** 切歌时记一笔。放在轨道组件里订阅当前曲目，而不是四处埋点。 */
export function markRoamHeard(track: Track | null): void {
  if (!track) return
  const key = trackKey(track)
  if (!isRoamTrack(track)) return
  const { heard } = useRoam.getState()
  if (heard[key]) return
  // replace 而不是 push：听到第几遍都算一首，轨道上那行字说的是「走了多少首」。
  useRoam.setState((prev) => ({ heard: { ...prev.heard, [key]: true } }))
}

/** 退出漫游：轨道收起来。队列不换，正在放的继续放。 */
export function endRoam(): void {
  useRoam.setState({ tracks: [], heard: {}, error: '' })
}
