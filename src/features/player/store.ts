import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createProfileScopedStorage, setActiveStorageProfile } from '../accounts/profile-storage.ts'
import type { RepeatMode, Track } from '../../types'
/*
 * Explicit `.ts` extension: tests import this module directly and run under Node,
 * whose ESM resolver does not guess extensions the way Vite does. See
 * tests/play-next.test.ts.
 */
import { identityOrder, reconcile, shuffledOrder } from './queue.ts'
import { volumeForUnmute } from './volume.ts'
/*
 * Explicit `.ts` extension for the same reason as queue.ts above: tests import
 * this module directly under Node.
 */
import { readSessionRestore } from '../settings/session-restore.ts'

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
 const EQ_FLAT: number[] = EQ_BANDS.map(() => 0)

/** Storage key, also the slot name inside the active profile's storage. */
const PREFS_KEY = 'aurora.player.prefs'

/**
 * The playback preferences of a fresh profile.
 *
 * Switching to a profile with nothing saved has to restore these explicitly.
 * zustand's persist merges what it finds into the current state, so a field the
 * new profile never saved would otherwise keep the previous profile's value -
 * volume and EQ would leak across profiles.
 */
function defaultPrefs() {
  return {
    volume: 0.85,
    muted: false,
    shuffle: false,
    repeat: 'off' as RepeatMode,
    eqEnabled: false,
    eqGains: [...EQ_FLAT],
    crossfadeSec: 0
  }
}

/**
 * Pure state. Nothing here touches the audio engine - the engine subscribes to
 * this store for *intent* and writes back *observations*, which keeps the data
 * flow one-directional and avoids action/report feedback loops.
 */
 interface PlayerState {
  queue: Track[]
  order: number[]
  index: number
  /** Whether the transport is rolling. Observation, owned by the engine. */
  playing: boolean
  /** Seconds. Observation. */
  position: number
  /** Seconds. Observation. */
  duration: number
  /** True while the engine is buffering a track. */
  loading: boolean
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  eqEnabled: boolean
  eqGains: number[]
  /** Crossfade length in seconds; 0 disables it. */
  crossfadeSec: number

  current(): Track | null
  setQueue(queue: Track[], startAt?: number): void
  enqueue(tracks: Track[], position?: 'next' | 'end'): void
  removeAt(queueIndex: number): void
  clearQueue(): void
  /** Drops everything that has not played yet; the current track keeps going. */
  clearUpcoming(): void
  jumpTo(queueIndex: number): void
  setPosition(position: number): void
  setDuration(duration: number): void
  setPlaying(playing: boolean): void
  setLoading(loading: boolean): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  setShuffle(shuffle: boolean): void
  setRepeat(repeat: RepeatMode): void
  setEqEnabled(enabled: boolean): void
  setEqGains(gains: number[]): void
  setCrossfade(seconds: number): void
}

/** Fisher-Yates. `sort(() => Math.random() - 0.5)` is not a shuffle. */
function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      order: [],
      index: -1,
      playing: false,
      position: 0,
      duration: 0,
      loading: false,
      ...defaultPrefs(),

      current() {
        const { queue, index } = get()
        return index >= 0 && index < queue.length ? queue[index] : null
      },

      setQueue(queue, startAt = 0) {
        const index = queue.length === 0 ? -1 : Math.min(Math.max(0, startAt), queue.length - 1)
        set({
          queue,
          index,
          order: get().shuffle ? shuffledOrder(queue.length, index) : identityOrder(queue.length),
          position: 0,
          duration: 0
        })
      },

      enqueue(tracks, position = 'end') {
        const { queue, index, order, shuffle } = get()
        if (tracks.length === 0) return

        if (position === 'next' && queue.length > 0 && index >= 0) {
          const insertAt = index + 1
          // Every existing index at or after the insertion point shifts up.
          const shifted = order.map((i) => (i >= insertAt ? i + tracks.length : i))
          // The new tracks land directly after whatever is playing.
          const at = shifted.indexOf(index)
          const added = tracks.map((_, k) => insertAt + k)
          set({
            queue: [...queue.slice(0, insertAt), ...tracks, ...queue.slice(insertAt)],
            order: [...shifted.slice(0, at + 1), ...added, ...shifted.slice(at + 1)]
          })
          return
        }

        const offset = queue.length
        const added = tracks.map((_, k) => offset + k)
        set({
          queue: [...queue, ...tracks],
          index: index === -1 && added.length > 0 ? added[0] : index,
          order: [...order, ...(shuffle ? shuffleInPlace([...added]) : added)]
        })
      },

      removeAt(queueIndex) {
        const { queue, index, order } = get()
        if (queueIndex < 0 || queueIndex >= queue.length) return
        const nextQueue = queue.filter((_, i) => i !== queueIndex)
        if (nextQueue.length === 0) {
          set({ queue: [], order: [], index: -1, position: 0, duration: 0, playing: false })
          return
        }
        // Anything after the removed slot shifts down by one.
        const remappedOrder = order
          .filter((i) => i !== queueIndex)
          .map((i) => (i > queueIndex ? i - 1 : i))
        const nextIndex =
          queueIndex === index ? Math.min(index, nextQueue.length - 1)
          : queueIndex < index ? index - 1
          : index
        const fixed = reconcile(nextQueue, remappedOrder, nextIndex)
        set({ queue: nextQueue, order: fixed.order, index: fixed.index })
      },

      clearQueue() {
        set({ queue: [], order: [], index: -1, position: 0, duration: 0, playing: false })
      },

      /*
       * Clearing used to mean "stop everything", which also throws away the
       * track you are listening to. This keeps the played list and the current
       * track and drops only what is still queued - the same split Rhine makes
       * (清空仅移除待播歌曲，当前歌曲继续播放).
       */
      clearUpcoming() {
        const { queue, order, index, position, playing } = get()
        if (index < 0 || queue.length === 0) return
        const at = order.indexOf(index)
        if (at === -1) return
        const keep = order.slice(0, at + 1)
        const nextQueue = keep.map((i) => queue[i])
        set({
          queue: nextQueue,
          order: nextQueue.map((_, i) => i),
          index: nextQueue.length - 1,
          position,
          playing
        })
      },

      jumpTo(queueIndex) {
        const { queue } = get()
        if (queueIndex < 0 || queueIndex >= queue.length) return
        set({ index: queueIndex, position: 0 })
      },

      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setPlaying: (playing) => set({ playing }),
      setLoading: (loading) => set({ loading }),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)), muted: false }),

      setMuted(muted) {
        if (muted) {
          set({ muted })
          return
        }
        /*
         * 取消静音时把 0 抬起来：否则 muted 关掉了、音量还是 0，按了跟没按一样。
         * 规则本身在 volume.ts 里，有单测。
         */
        set({ muted, volume: volumeForUnmute(get().volume) })
      },

      setShuffle(shuffle) {
        const { queue, index } = get()
        set({
          shuffle,
          order: shuffle ? shuffledOrder(queue.length, index) : identityOrder(queue.length)
        })
      },

      setRepeat: (repeat) => set({ repeat }),
      setEqEnabled: (eqEnabled) => set({ eqEnabled }),
      setEqGains: (eqGains) => set({ eqGains }),
      setCrossfade: (crossfadeSec) => set({ crossfadeSec })
    }),
    {
      name: PREFS_KEY,
      version: 1,
      /*
       * 加载交给 loadProfilePlayerPrefs 显式做。store 一创建就自动 hydrate 会
       * 在没有任何人盯着的时候把队列灌进来，订阅把它当成用户点了歌，一启动
       * 就自己响；那时也还不知道该读哪个 profile 的槽。
       */
      skipHydration: true,
      // Keyed by the active profile: volume and EQ belong to the person, not to
      // the machine.
      storage: createJSONStorage(createProfileScopedStorage),
      //
      // 用户偏好总是留着；队列只在「启动时恢复上次队列」开着时一起存。
      // 不存 position：恢复后停在 0:00，比从半截接上稳。
      //
      partialize: (state) => ({
        volume: state.volume,
        muted: state.muted,
        shuffle: state.shuffle,
        repeat: state.repeat,
        eqEnabled: state.eqEnabled,
        eqGains: state.eqGains,
        crossfadeSec: state.crossfadeSec,
        ...(readSessionRestore()
          ? { queue: state.queue, index: state.index, order: state.order }
          : {})
      })
    }
  )
)

/**
 * Point the playback preferences at a profile and load that profile's copy.
 *
 * Same ordering rule as the playlist store: read the slot first, and only reset
 * when it is genuinely empty. Clearing first would let the persist middleware
 * write the cleared state over the preferences of the profile being switched to.
 */
/**
 * 恢复队列的那一次 rehydrate：这期间 index 从 -1 跳到某首歌，
 * actions 的订阅不该把它当成「用户点了播放」。
 */
let restoringPrefs = false

export function isRestoringPrefs(): boolean {
  return restoringPrefs
}

export async function loadProfilePlayerPrefs(profileId: string | null): Promise<void> {
  setActiveStorageProfile(profileId)

  const stored = createProfileScopedStorage().getItem(PREFS_KEY)
  if (stored === null) {
    usePlayer.setState({ ...defaultPrefs(), queue: [], index: -1, order: [] })
    return
  }

  restoringPrefs = true
  try {
    await usePlayer.persist.rehydrate()
  } finally {
    restoringPrefs = false
  }

  /*
   * 开关关掉时连读都不读。只靠 partialize 只管写：关掉后盘上仍留着上一次
   * 的队列，这次启动照样会读回来，要等下一次写盘才真的消失。
   */
  if (!readSessionRestore()) {
    usePlayer.setState({ queue: [], index: -1, order: [] })
    return
  }

  /*
   * 队列是按 profile 存的：换到一个没存过队列的 profile 时，persist 只会
   * 合并它有的字段，旧队列会留在内存里。没有就是没有，显式清空。
   */
  let carriesQueue = false
  try {
    const parsed = JSON.parse(stored) as { state?: { queue?: unknown } }
    carriesQueue = Array.isArray(parsed.state?.queue)
  } catch {
    carriesQueue = false
  }
  if (!carriesQueue) usePlayer.setState({ queue: [], index: -1, order: [] })
}
