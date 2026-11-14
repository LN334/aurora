import { create } from 'zustand'
import type { Track } from '../../types'
import {
  HISTORY_KEY,
  addPlay,
  addRecent,
  addSeconds,
  emptyHistory,
  parseHistory,
  prunePlays,
  serializeHistory,
  todaySummary
} from './history'
import type { HistoryState, PlayEntry, RecentEntry, TodaySummary } from './history'

/**
 * Listening history, persisted to localStorage.
 *
 * The engine is the only writer: it knows when a track really started and how
 * many seconds actually played. Two throttles keep that from turning into a
 * write per frame — the engine batches to whole seconds, and this store batches
 * to one write every `FLUSH_MS` (plus immediately on track change, pause and
 * window unload, so nothing meaningful is lost if the app is closed).
 */

/** How often buffered seconds reach localStorage while playing. */
const FLUSH_MS = 5000

/** Total seconds buffered before an early flush; keeps a long song responsive. */
const FLUSH_SECONDS = 20

interface PendingSpan {
  track: Track
  seconds: number
}

interface HistoryStore {
  history: HistoryState
  /** Not yet written to localStorage, keyed by track id. */
  pending: Record<string, PendingSpan>
  lastFlush: number
  /** A track began playing. */
  noteStart(track: Track): void
  /** Seconds observed by the engine for the track that is playing. */
  noteSeconds(track: Track, seconds: number): void
  /** Push buffered seconds out now. */
  flush(): void
  reload(): void
  clear(): void
}

function load(): HistoryState {
  try {
    return parseHistory(window.localStorage.getItem(HISTORY_KEY))
  } catch {
    return emptyHistory()
  }
}

function write(state: HistoryState): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(serializeHistory(state)))
  } catch {
    // Storage being full or disabled must never break playback.
  }
}

function bufferedSeconds(pending: Record<string, PendingSpan>): number {
  let total = 0
  for (const span of Object.values(pending)) total += span.seconds
  return total
}

export const useHistory = create<HistoryStore>((set, get) => ({
  history: load(),
  pending: {},
  lastFlush: 0,

  noteStart(track) {
    const now = Date.now()
    // 一份时间戳给两条记录：书架（recent）与明细（plays）说的必须是同一件事。
    const history = addPlay(addRecent(get().history, track, now), track, now)
    write(history)
    set({ history })
  },

  noteSeconds(track, seconds) {
    if (!(seconds > 0)) return
    const pending = { ...get().pending }
    const span = pending[track.id]
    pending[track.id] = { track, seconds: (span?.seconds ?? 0) + seconds }
    set({ pending })
    if (Date.now() - get().lastFlush >= FLUSH_MS || bufferedSeconds(pending) >= FLUSH_SECONDS) {
      get().flush()
    }
  },

  flush() {
    const { pending, history } = get()
    const ids = Object.keys(pending)
    if (ids.length === 0) {
      set({ lastFlush: Date.now() })
      return
    }
    const now = Date.now()
    let next = history
    for (const id of ids) {
      const span = pending[id]
      if (!span || !(span.seconds > 0)) continue
      next = addSeconds(next, span.track, span.seconds, now)
    }
    next = prunePlays(next, now)
    write(next)
    set({ history: next, pending: {}, lastFlush: now })
  },

  reload() {
    set({ history: load(), pending: {}, lastFlush: 0 })
  },

  clear() {
    write(emptyHistory())
    set({ history: emptyHistory(), pending: {}, lastFlush: 0 })
  }
}))

/** Persist on the way out; a closed window should not eat the last few seconds. */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => useHistory.getState().flush())
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') useHistory.getState().flush()
  })
}

/** Recently played, newest first. */
export function useRecentEntries(): RecentEntry[] {
  return useHistory((state) => state.history.recent)
}

/** Every play, newest first. The week view groups these by day. */
export function usePlayEntries(): PlayEntry[] {
  return useHistory((state) => state.history.plays)
}

/** Today's headline numbers, derived at render time. */
export function useToday(now = Date.now()): TodaySummary {
  return todaySummary(useHistory((state) => state.history), now)
}
