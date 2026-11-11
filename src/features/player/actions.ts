import type { Track } from '../../types'
import { engineHooks } from './engine'
import { applyMode, modeOf, nextMode } from './mode'
import { driver } from './driver'
import { step } from './queue'
import { isRestoringPrefs, usePlayer } from './store'
import { showFlash } from '../../ui/flash'

/**
 * User intents. Components call these; they mutate the store and drive the
 * driver. Keeping them out of the store is what stops the store from depending
 * on the audio graph.
 */

function loadCurrent(autoplay: boolean): void {
  const track = usePlayer.getState().current()
  if (!track) return
  void driver.load(track, autoplay)
}

/**
 * 连着几首没源就停。
 *
 * 漫游池里混着会员曲（QQ 回 vip-required），一首坏就跳是对的；整池都坏时一路跳
 * 到底会让界面像失控。原先定三首，实测点一次漫游就能连撞三首（快池开局可能整批
 * 来自同一家），用户听到的只剩一个劲儿切歌。放宽到六首：依然分得清「偶发」和
 * 「这一趟放不了」，但足够穿过开头那一段坏曲。
 */
const MAX_SKIP_CHAIN = 6

/** 已经为「没源」自动跳过几首。播到有源的歌、或用户自己点歌，就归零。 */
let skipChain = 0

/**
 * 整条队列被换掉时先通知一声。
 *
 * 漫游据此结束自己那一趟：用户去点了一个歌单、一张专辑、或者「播放全部」，
 * 意思就是「不漫游了」。不通知的话播放条还写着「漫游中」、队列面板还叫
 * 「漫游 · 接下来」，而实际放的是那份歌单。
 */
let queueResetHook: (() => void) | null = null

export function onQueueReset(hook: (() => void) | null): void {
  queueResetHook = hook
}

/** Standard transport behaviour: back within 3s restarts rather than rewinds. */
const PREV_RESTART_WINDOW = 3

export const player = {
  playQueue(tracks: Track[], startAt = 0): void {
    // 换了整条队列：漫游那一趟到此为止（漫游自己换队列时这个钩子会让开）。
    queueResetHook?.()
    // 用户自己点的一趟：跳过链从零开始数。
    skipChain = 0
    usePlayer.getState().setQueue(tracks, startAt)
    loadCurrent(true)
  },

  playTrack(track: Track): void {
    player.playQueue([track], 0)
  },

  addToQueue(tracks: Track[], position: 'next' | 'end' = 'end'): void {
    const before = usePlayer.getState().queue.length
    usePlayer.getState().enqueue(tracks, position)
    const after = usePlayer.getState()
    // Adding to an idle player should start it.
    if (before === 0 && after.queue.length > 0) loadCurrent(true)
  },

  toggle(): void {
    const state = usePlayer.getState()
    const track = state.current()
    if (!track) return
    if (state.playing) {
      driver.pause()
      return
    }
    /*
     * 启动时恢复的队列只是摆在那儿，没有真的指上音频元素。这时按播放要把
     * 当前这首装上再放，否则 play() 打在空元素上，按了不出声。
     */
    if (!driver.isTrackReady(track)) {
      loadCurrent(true)
      return
    }
    void driver.play()
  },

  play(): void {
    const state = usePlayer.getState()
    if (!state.current()) return
    void driver.play()
  },

  pause(): void {
    driver.pause()
  },

  next(fromEnd = false): void {
    // 用户自己按的下一首不算「自动跳过」，计数归零。
    if (!fromEnd) skipChain = 0
    const state = usePlayer.getState()
    const target = step(state.order, state.index, 1, state.repeat)

    if (!target) {
      // Queue exhausted with repeat off: stop cleanly at the end.
      if (fromEnd) {
        driver.pause()
        driver.seek(0)
        return
      }
      // A manual "next" on the last track restarts the queue from the top.
      if (state.queue.length > 0) {
        state.jumpTo(state.order[0] ?? 0)
        loadCurrent(true)
      }
      return
    }

    state.jumpTo(target.index)
    loadCurrent(true)
  },

  /**
   * 这一首取不到任何音源：跳下一首。
   *
   * 引擎在 pickPlayable 全败时只报告「没有源」，跳不跳由这里决定——队列、
   * 重复模式、连跳了几首，都只有这一侧知道。
   */
  skipUnplayable(track: Track): void {
    const mine = usePlayer.getState().current()
    /*
     * 同一首会被两路取流各报一次（引擎的 load 与地址迟到后的补流），只有它
     * 还是当前曲时才算新的一次；否则一首坏歌就能把三首的额度吃光。
     */
    if (mine?.id !== track.id) return

    if (skipChain + 1 >= MAX_SKIP_CHAIN) {
      skipChain = 0
      showFlash(`连着 ${MAX_SKIP_CHAIN} 首都取不到音源，先停在这里`)
      return
    }
    skipChain += 1
    player.next(true)
  },

  prev(): void {
    skipChain = 0
    const state = usePlayer.getState()
    if (state.position > PREV_RESTART_WINDOW) {
      driver.seek(0)
      return
    }
    const target = step(state.order, state.index, -1, state.repeat)
    if (!target) {
      driver.seek(0)
      return
    }
    state.jumpTo(target.index)
    loadCurrent(true)
  },

  /**
   * 从队列里摘掉一首。
   *
   * 只摘队列位置，不碰"这一趟"的列表——那是调用方的事。摘掉的是正在放的这首
   * 时，队列索引会落到后一首上；索引没变，订阅就收不到，所以这里补一次加载，
   * 否则歌已经不在队列里了，声音还在响。
   */
  removeFromQueue(queueIndex: number): void {
    const state = usePlayer.getState()
    if (queueIndex < 0 || queueIndex >= state.queue.length) return
    const wasCurrent = queueIndex === state.index
    const before = state.index
    state.removeAt(queueIndex)
    const after = usePlayer.getState()
    if (wasCurrent && after.index === before) loadCurrent(true)
  },

  jumpTo(orderPosition: number): void {
    skipChain = 0
    const state = usePlayer.getState()
    if (orderPosition < 0 || orderPosition >= state.order.length) return
    state.jumpTo(state.order[orderPosition])
    loadCurrent(true)
  },

  seekTo(seconds: number): void {
    driver.seek(seconds)
  },

  seekRatio(ratio: number): void {
    const { duration } = usePlayer.getState()
    if (duration <= 0) return
    driver.seek(ratio * duration)
  },

  nudge(seconds: number): void {
    const { position } = usePlayer.getState()
    driver.seek(position + seconds)
  },

  setVolume(volume: number): void {
    usePlayer.getState().setVolume(volume)
    driver.setVolume()
  },

  toggleMute(): void {
    usePlayer.getState().setMuted(!usePlayer.getState().muted)
    driver.setVolume()
  },

  /**
   * 播放模式点一次走到下一档：顺序 → 列表循环 → 单曲循环 → 随机 → 顺序。
   *
   * 内核还是 shuffle + repeat 两个字段（漫游换队列、持久化、队列步进都读它们），
   * 合并只发生在界面上。先改 shuffle 再改 repeat：setShuffle 会重排 order，
   * 与 repeat 互不影响，这样写只是跟界面的顺序对齐。
   */
  cycleMode(): void {
    const state = usePlayer.getState()
    const next = applyMode(nextMode(modeOf(state.shuffle, state.repeat)))
    if (next.shuffle !== state.shuffle) state.setShuffle(next.shuffle)
    state.setRepeat(next.repeat)
  },

  setEqEnabled(enabled: boolean): void {
    usePlayer.getState().setEqEnabled(enabled)
    driver.setEq()
  },

  setEqGains(gains: number[]): void {
    usePlayer.getState().setEqGains(gains)
    driver.setEq()
  },

  resetEq(): void {
    usePlayer.getState().setEqGains(usePlayer.getState().eqGains.map(() => 0))
    driver.setEq()
  }
}

// --- wiring ----------------------------------------------------------------

engineHooks.next = (fromEnd) => player.next(fromEnd)
engineHooks.prev = () => player.prev()
// 引擎报「没源」时由播放器决定跳到哪；报「装上了」时把跳过链归零。
engineHooks.unplayable = (track) => player.skipUnplayable(track)
engineHooks.playable = () => {
  skipChain = 0
}

/**
 * The queue index is the single trigger for loading a track: wherever the index
 * moves - a click, a double-click, a media key - the engine follows.
 */
let lastIndex = usePlayer.getState().index
usePlayer.subscribe((state) => {
  if (state.index === lastIndex) return
  const wasIdle = lastIndex === -1
  lastIndex = state.index
  // 恢复出来的队列不该一启动就自己响；等用户按播放（toggle 会自己装载）。
  if (isRestoringPrefs()) return
  // Advancing an already-playing queue keeps rolling; selecting the first track
  // of an idle player starts it.
  if (state.playing || wasIdle) loadCurrent(true)
})
