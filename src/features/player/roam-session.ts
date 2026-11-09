import { create } from 'zustand'
import type { RepeatMode, Track } from '../../types'
import { SLOTS } from '../online/slots'
import { trackKey } from '../online/unify'
import { player } from './actions'
import {
  appendFresh,
  remainingSeconds,
  roamProgress,
  shouldPullMore,
  type RoamProgress,
  withoutTrack
} from './roam-pure'
import { buildRoamQueue, loadRoamPool, loadRoamStream, loadSeedTracks } from './roam'
import { roamPlatforms } from './roam-sources'
import { usePlayer } from './store'

/**
 * 一趟漫游。
 *
 * 漫游不是一个页面，是一次播放会话：左栏点它就换掉队列开始放，播放页底下长出
 * 一条轨道。所以这一份状态必须活得比任何页面久，放在 store 里；页面组件只读它。
 *
 * 三条规矩先定下来，下面每一处都照着写：
 *
 * 1. 一直持续——快到这一趟的尾巴时就把下一批要过来接上，不等最后一首。
 * 2. 不重复——同一首在这一趟里只放一次；最近放过的也记着，下一趟尽量不再推。
 * 3. 不主动停止——循环是关的（循环会把放过的再放一遍，和上一条冲突），
 *    真到队列尽头只说明没要到新歌，过一会儿再要，而不是就此收工。
 *
 * 三样状态刻意分开：
 *
 * 1. `tracks` 是这一趟的全部候选，只增不减，除了被划掉的那首。
 * 2. 播放队列是 `tracks` 的一份拷贝（可能顺序不同、可能被别的操作插过歌）。
 *    两者用 `trackKey` 对上，不靠数组下标——下标会被 shuffle 和插队打乱。
 * 3. `heard` 记录这一趟里听过哪些。它不是播放历史，只服务「已听 6 / 20」这行字
 *    与「接着上次听」的落点。
 */

/** 划掉过的歌。会话结束后仍然不算漫游——同一个推荐反复出现正是漫游最烦的事。 */
const HIDE_KEY = 'aurora.roam.hidden'

/** 划掉列表的上限。推荐流是长期的，不封顶会一直长。 */
const HIDE_LIMIT = 300

/** 最近放过的歌，跨趟也记着。上限到了就滚掉最早的那几首，不是永远不再推。 */
const PLAYED_KEY = 'aurora.roam.played'
const PLAYED_LIMIT = 200

/** 剩下几首时开始要下一批：留出提前量，免得等到最后一首才开始要、中间断一口气。 */
const AHEAD = 6

/**
 * 还剩多少秒时开始要下一批。
 *
 * 首数是个不稳的尺子：6 首短歌二十分钟不到，6 首现场版能撑四十分钟。所以两条
 * 判据并行——首数先到就先补，剩余时长先到也先补；时长缺失时退回只看首数。
 */
const PULL_SECONDS = 900

function readKeys(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

function writeKeys(key: string, keys: Set<string>, limit: number): void {
  try {
    localStorage.setItem(key, JSON.stringify([...keys].slice(-limit)))
  } catch {
    // 存不进去就只在这次会话里有效，不该因此让漫游失败。
  }
}

/**
 * 要歌时要跳过哪些。
 *
 * 划掉的是长期的，最近放过的是滚动的：两者都算「这一首别再给我」。
 */
function browsedOut(): Set<string> {
  const out = readKeys(HIDE_KEY)
  for (const key of readKeys(PLAYED_KEY)) out.add(key)
  return out
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
  /**
   * 进这一趟时被换掉的循环模式。
   *
   * 漫游不重复，循环必须关掉；而播放页与底栏在漫游里都不给循环那颗键，所以
   * 不在这里换就没有别处能改。退出时还原。
   */
  parkedRepeat: RepeatMode | null
  /**
   * 刚被撤掉的那一首，只活三秒。
   *
   * 「不想再听」是一次不可见的写操作（进黑名单），划错了没有第二次机会，所以
   * 轨道上留一条能撤回的提示。同一次会话里只记最后一首。
   */
  dropped: DroppedTrack | null
  /**
   * 这一趟从哪首出发；null 就是没有种子。
   *
   * 种子只是「怎么排」的依据，不是「只能放像的」：排完照样取满几十首，种子自己
   * 排第一。收起那行字、退出漫游都回到 null。
   */
  seed: Track | null
}

/** 撤掉一首的两种意思：跳过这一次，还是以后都别再推。 */
export type RoamDropReason = 'skip' | 'dislike'

export interface DroppedTrack {
  track: Track
  reason: RoamDropReason
}

export const useRoam = create<RoamState>()(() => ({
  tracks: [],
  heard: {},
  busy: false,
  pulling: false,
  error: '',
  parkedRepeat: null,
  dropped: null,
  seed: null
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

/** 这一批补多少首：一趟的一半。多了慢，少了接不上。 */
export const ROAM_MORE = Math.ceil(SLOTS.roam / 2)

/**
 * 把循环换成「关」，原模式记着等退出时还原。
 *
 * 两处要调：开新趟，以及回到一趟没结束的旧漫游。后者容易被漏掉——用户退出漫游后
 * 又手动开了列表循环，再点漫游，队列会从头绕回来，和「不重复」冲突。
 */
function parkRepeat(): void {
  const before = usePlayer.getState().repeat
  if (before === 'off') return
  if (!useRoam.getState().parkedRepeat) useRoam.setState({ parkedRepeat: before })
  usePlayer.getState().setRepeat('off')
}

/**
 * 点「漫游」。
 *
 * 有这一趟就接着听：先找第一首没听过的。没有就现要一趟。返回 true 表示队列已经
 * 换好，调用方可以进播放页；false 表示这次没成，原因写在 error 里。
 *
 * 带一个种子进来是另一条路：「从这首出发」明确要换一趟，所以不接上一趟的账，
 * 而是把池子按与那首的亲疏重排，种子排第一。
 */
export async function startRoam(seed?: Track): Promise<boolean> {
  /*
   * 导航栏那颗「漫游」是 onClick={onRoam}，React 会把点击事件当第一个参数塞进来。
   * 加种子之前 startRoam 不收参数，所以没人发现；加了种子之后事件对象就成了
   * 「种子」，下面读 seed.artist.trim() 直接抛 TypeError。这里按「像不像一首歌」
   * 判一下，不像就当作没带种子。
   */
  const chosen = seed && typeof seed.artist === 'string' && typeof seed.title === 'string' ? seed : undefined
  const state = useRoam.getState()
  if (state.busy) return false

  const current = usePlayer.getState().current()
  if (!chosen && state.tracks.length > 0) {
    // 这一趟还在：从第一首没听过的接着放。全都听过就从头，反正下面会补新的。
    if (current && isRoamTrack(current)) {
      parkRepeat()
      return true
    }
    const heard = state.heard
    const at = state.tracks.findIndex((track) => !heard[trackKey(track)])
    parkRepeat()
    player.playQueue(state.tracks, at >= 0 ? at : 0)
    return true
  }

  useRoam.setState({ busy: true, error: '' })
  try {
    const wanted = roamPlatforms()
    // 种子模式要两路一起要：平台今天推的，和这个人的歌。
    const [pool, near] = await Promise.all([
      loadRoamPool(wanted),
      chosen ? loadSeedTracks(chosen, wanted) : Promise.resolve([] as Track[])
    ])
    const hidden = readKeys(HIDE_KEY)
    /*
     * 同艺人的歌多半是用户手上已有的，严格说不算「新的」；但这一趟要的就是从这一
     * 首走进这个人的作品里，所以并进来一起排序。种子自己也在 near 里，建队列时去重。
     */
    const queue = buildRoamQueue(
      chosen ? { ...pool, freshTracks: [...near, ...pool.freshTracks] } : pool,
      SLOTS.roam,
      chosen
    )
    // 名单只读一次；以前放在 filter 回调里，每首歌都要读一遍 localStorage。
    const skip = browsedOut()
    // 种子是用户亲手挑的：哪怕它在「不想再听」名单里，这一趟也得放它。
    const keep = chosen ? trackKey(chosen) : ''
    let tracks = queue.filter((track) => {
      const key = trackKey(track)
      return key === keep || !skip.has(key)
    })
    if (tracks.length === 0) {
      // 排除名单把池子吃空了。这是名单自己的问题：清掉滚动的部分再试一次，
      // 划掉的仍然排除。不清就会变成「漫游永远要不到歌」。
      writeKeys(PLAYED_KEY, new Set(), PLAYED_LIMIT)
      tracks = queue.filter((track) => trackKey(track) === keep || !hidden.has(trackKey(track)))
    }
    if (tracks.length === 0) {
      useRoam.setState({ busy: false, error: '这几家今天还没推过来，换几家或过会儿再试' })
      return false
    }
    // 漫游不重复：循环会让放过的再来一遍，先关掉，退出时还原。
    useRoam.setState({
      tracks,
      heard: {},
      seed: chosen ?? null,
      busy: false,
      pulling: false,
      error: ''
    })
    parkRepeat()
    player.playQueue(tracks, 0)
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    useRoam.setState({ busy: false, error: '这一趟没要到：' + (reason || '不知道哪儿出了岔子') })
    return false
  }
}

/**
 * 往后接一批。
 *
 * 列表与队列一起长：只长列表的话点尾巴卡会从头重放，只长队列的话轨道上看不到。
 * 正在放的这首不打断。要到的与手上的重复就说明平台今天翻到头了，记一句话，
 * 调用方自己决定过多久再试。
 */
export async function pullRoamMore(): Promise<void> {
  const state = useRoam.getState()
  if (state.pulling) return
  useRoam.setState({ pulling: true, error: '' })
  try {
    const more = await loadRoamStream(ROAM_MORE)
    const fresh = appendFresh(useRoam.getState().tracks, more, browsedOut())
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

let undoClock: ReturnType<typeof setTimeout> | null = null

/** 撤回提示活三秒：够看见、够点，但不至于在下一次换歌时还挂着。 */
const UNDO_MS = 3000

function clearUndoClock(): void {
  if (!undoClock) return
  clearTimeout(undoClock)
  undoClock = null
}

/**
 * 撤掉一首。
 *
 * 两种意思，用户分得清，代码也要分清：
 *
 * - `skip`：这一次不想听。从这一趟里拿掉就完了，不进黑名单——跳过不等于讨厌，
 *   把两者混成一个「划掉」，名单会越攒越大，最后推什么都不对。
 * - `dislike`：以后别再推。除了拿掉，还写进持久名单（上限 300 首）。
 *
 * 两种情况都做同一件事：从轨道和队列里一起摘掉。正在放的就是它，队列索引会落到
 * 后一首上，就地换歌——否则卡片没了歌还在响，看起来像没生效。
 */
export function hideRoamTrack(track: Track, reason: RoamDropReason = 'dislike'): void {
  if (reason === 'dislike') {
    const hidden = readKeys(HIDE_KEY)
    hidden.add(trackKey(track))
    writeKeys(HIDE_KEY, hidden, HIDE_LIMIT)
  }
  useRoam.setState((prev) => ({ tracks: withoutTrack(prev.tracks, track) }))
  // 队列里也摘掉：只从轨道上拿走的话，放到它时还会响，看起来像划掉没生效。
  const at = usePlayer.getState().queue.findIndex((item) => trackKey(item) === trackKey(track))
  if (at >= 0) player.removeFromQueue(at)

  clearUndoClock()
  useRoam.setState({ dropped: { track, reason } })
  undoClock = setTimeout(() => {
    undoClock = null
    if (useRoam.getState().dropped?.track === track) useRoam.setState({ dropped: null })
  }, UNDO_MS)
}

/**
 * 撤回上一次撤掉的那首。
 *
 * 名单里删掉（如果是「不想再听」），轨道末尾放回去，队列末尾也补一份——队列里
 * 那一份刚被摘掉了，不补回来会出现「列表里有、放到这首时跳过」的怪状态。
 * 放末尾而不是原位：这排是候选，不是一条有承诺的顺序，插回中间会把正在看的位置顶开。
 */
export function undoDrop(): void {
  const dropped = useRoam.getState().dropped
  if (!dropped) return
  clearUndoClock()
  const { track, reason } = dropped
  const key = trackKey(track)
  if (reason === 'dislike') {
    const hidden = readKeys(HIDE_KEY)
    if (hidden.delete(key)) writeKeys(HIDE_KEY, hidden, HIDE_LIMIT)
  }
  useRoam.setState((prev) => ({
    tracks: prev.tracks.some((item) => trackKey(item) === key) ? prev.tracks : [...prev.tracks, track],
    dropped: null
  }))
  player.addToQueue([track], 'end')
}

/**
 * 切歌时记一笔。
 *
 * 记「已听」是给轨道上那行字，记「放过」是给下一趟去重——两个都只该在切歌时写，
 * 所以由下面的订阅统一调用，不在组件里到处埋。
 */
export function markRoamHeard(track: Track | null): void {
  if (!track) return
  const key = trackKey(track)
  if (!isRoamTrack(track)) return
  const { heard } = useRoam.getState()
  if (!heard[key]) useRoam.setState((prev) => ({ heard: { ...prev.heard, [key]: true } }))
  const played = readKeys(PLAYED_KEY)
  if (played.has(key)) return
  played.add(key)
  writeKeys(PLAYED_KEY, played, PLAYED_LIMIT)
}

/**
 * 收起「从〈某首〉出发」那行字。
 *
 * 只摘标记，不动已经排好的队列：点 × 的多半是嫌那行字占地方，不是要把这一趟
 * 重排一遍。下一趟从漫游按钮进来就是纯随机。
 */
export function dropSeed(): void {
  if (!useRoam.getState().seed) return
  useRoam.setState({ seed: null })
}

/** 退出漫游：轨道收起来。队列不换，正在放的继续放；被换掉的循环模式放回去。 */
export function endRoam(): void {
  clearUndoClock()
  const { parkedRepeat } = useRoam.getState()
  if (parkedRepeat) usePlayer.getState().setRepeat(parkedRepeat)
  useRoam.setState({
    tracks: [],
    heard: {},
    error: '',
    parkedRepeat: null,
    dropped: null,
    seed: null
  })
}

let retry: ReturnType<typeof setTimeout> | null = null

/** 队列快见底了就再要一批。失败也接着要，漫游不主动停止。 */
function refillIfLow(): void {
  const roam = useRoam.getState()
  if (roam.tracks.length === 0) return
  const now = usePlayer.getState()
  const current = now.current()
  if (!current || !isRoamTrack(current)) return
  const left = now.queue.length - now.index - 1
  const leftSec = remainingSeconds(now.queue, now.index)
  // 首数到了就补；首数没到但剩下的时长不够了（长曲之后常发生）也补。
  // 时长为 0 表示这一批都没给时长，这时只用首数判据，免得每切一首都要一次网络。
  const soon = shouldPullMore(left, AHEAD) || (leftSec > 0 && leftSec < PULL_SECONDS)
  if (!soon) return
  void pullRoamMore().then(() => {
    // 断网、平台重复推：先记一句话，过一会儿再来。队列真走到尽头也由这里的重试接着。
    if (!useRoam.getState().error || retry) return
    retry = setTimeout(() => {
      retry = null
      refillIfLow()
    }, 8000)
  })
}

/**
 * 切歌就记一笔，顺便看一眼要不要补。
 *
 * 订阅放在模块里而不是播放页里：用户离开播放页、在首页听歌时，这一趟也要接着长。
 */
usePlayer.subscribe((state, prev) => {
  if (state.index === prev.index && state.queue === prev.queue) return
  markRoamHeard(state.current())
  refillIfLow()
})
