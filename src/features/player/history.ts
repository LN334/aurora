import type { Track } from '../../types'

/**
 * Listening history and the daily tally behind the home page.
 *
 * Everything here is a pure function over plain data so it can be tested
 * without a browser: the store owns persistence, the engine owns the clock.
 * Timestamps are epoch milliseconds, buckets are local calendar days — "today"
 * should mean the user's today, not UTC's.
 */

export const HISTORY_KEY = 'aurora.play.history'
const HISTORY_VERSION = 1

/** How many recently played tracks to keep. Long enough to fill a rail. */
export const RECENT_LIMIT = 60

/** How many days of listening time to keep before pruning the oldest. */
export const DAY_LIMIT = 30

/**
 * Starting the same track twice within this window is one play.
 *
 * Skipping back and forth through a queue should not flood the rail with the
 * same row, but coming back to a song an hour later genuinely is a new play.
 */
export const DEDUP_WINDOW_MS = 3 * 60 * 1000

export interface RecentEntry {
  id: string
  title: string
  artist: string
  album: string
  /** Absent means the local library, same convention as `Track.source`. */
  source?: string
  /** When it started playing. */
  at: number
  /**
   * Snapshot of the track, so a row can be played again without asking the
   * library or a platform to resolve it. Plain data, so it survives JSON.
   */
  track?: Track
}

/** How many days of individual plays to keep. A season is enough for "what was I into". */
export const PLAY_DAYS = 180

/**
 * Hard cap on detail rows.
 *
 * The day window alone cannot bound size: three hours of skipping through a
 * playlist is a few hundred starts. 2,000 rows is a couple of megabytes at the
 * snapshot size, which still fits next to everything else in localStorage.
 */
export const PLAY_LIMIT = 2000

/**
 * Restarting the same track within this window is the same play.
 *
 * The rail deduplicates for three minutes, which is right for "recently
 * played" but would erase the second of two deliberate listens; half a minute
 * only folds the A-B-A-B of someone auditioning a queue.
 */
export const PLAY_DEDUP_MS = 30 * 1000

/**
 * One listened play, newest first in the store.
 *
 * Same shape as a recent entry on purpose: a play needs exactly the same
 * snapshot to be replayed later, and keeping two shapes would mean two
 * validators.
 */
export type PlayEntry = RecentEntry

interface DayStat {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  seconds: number
  /** Distinct track ids played that day. */
  trackIds: string[]
  /** Seconds per artist, for "most listened" without a second store. */
  artists: Record<string, number>
}

export interface HistoryState {
  version: number
  recent: RecentEntry[]
  days: DayStat[]
  /** Every play, not one row per song: this is what the week view groups by day. */
  plays: PlayEntry[]
}

export interface TodaySummary {
  seconds: number
  tracks: number
  topArtist: string | null
  topArtistSeconds: number
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Local calendar day of an instant. */
export function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function emptyHistory(): HistoryState {
  return { version: HISTORY_VERSION, recent: [], days: [], plays: [] }
}

function validEntry(raw: unknown): RecentEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id) return null
  if (typeof item.title !== 'string') return null
  if (typeof item.at !== 'number' || !Number.isFinite(item.at)) return null
  return {
    id: item.id,
    title: item.title,
    artist: typeof item.artist === 'string' ? item.artist : '',
    album: typeof item.album === 'string' ? item.album : '',
    source: typeof item.source === 'string' && item.source ? item.source : undefined,
    at: item.at,
    track: item.track && typeof item.track === 'object' ? (item.track as Track) : undefined
  }
}

function validDay(raw: unknown): DayStat | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (typeof item.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.day)) return null
  const seconds = typeof item.seconds === 'number' && Number.isFinite(item.seconds) ? item.seconds : 0
  const trackIds = Array.isArray(item.trackIds)
    ? item.trackIds.filter((id): id is string => typeof id === 'string')
    : []
  const artists: Record<string, number> = {}
  if (item.artists && typeof item.artists === 'object') {
    for (const [name, value] of Object.entries(item.artists as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) artists[name] = value
    }
  }
  return { day: item.day, seconds: Math.max(0, seconds), trackIds, artists }
}

/**
 * Parse whatever was in localStorage.
 *
 * A malformed or older payload degrades to an empty history rather than
 * throwing: losing the tally is a cosmetic problem, a crash on boot is not.
 */
export function parseHistory(raw: string | null): HistoryState {
  if (!raw) return emptyHistory()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyHistory()
  }
  if (!parsed || typeof parsed !== 'object') return emptyHistory()
  const source = parsed as Record<string, unknown>

  const recent: RecentEntry[] = []
  const seen = new Set<string>()
  if (Array.isArray(source.recent)) {
    for (const item of source.recent) {
      const entry = validEntry(item)
      if (!entry || seen.has(entry.id)) continue
      seen.add(entry.id)
      recent.push(entry)
      if (recent.length >= RECENT_LIMIT) break
    }
  }

  const days: DayStat[] = []
  if (Array.isArray(source.days)) {
    for (const item of source.days) {
      const day = validDay(item)
      if (day) days.push(day)
    }
  }
  days.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))

  /*
   * Plays are not deduplicated: hearing a song twice is two rows. Old payloads
   * simply have no array, and the week view falls back to `recent`.
   */
  const plays: PlayEntry[] = []
  if (Array.isArray(source.plays)) {
    for (const item of source.plays) {
      const entry = validEntry(item)
      if (!entry) continue
      plays.push(entry)
      if (plays.length >= PLAY_LIMIT) break
    }
  }

  return { version: HISTORY_VERSION, recent, days: days.slice(0, DAY_LIMIT), plays }
}

/** The stored shape, trimmed to the retention limits. */
export function serializeHistory(state: HistoryState): HistoryState {
  return {
    version: HISTORY_VERSION,
    recent: state.recent.slice(0, RECENT_LIMIT),
    days: state.days.slice(0, DAY_LIMIT),
    plays: state.plays.slice(0, PLAY_LIMIT)
  }
}

function entryFor(track: Track, at: number): RecentEntry {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    source: track.source && track.source !== 'local' ? track.source : undefined,
    at,
    track
  }
}

/**
 * Record that a track started playing.
 *
 * The newest entry always goes first; a repeat inside `DEDUP_WINDOW_MS` only
 * refreshes the timestamp so the rail keeps one row per song.
 */
export function addRecent(state: HistoryState, track: Track, at: number): HistoryState {
  const latest = state.recent[0]
  if (latest && latest.id === track.id && at - latest.at < DEDUP_WINDOW_MS) {
    return { ...state, recent: [{ ...latest, at }, ...state.recent.slice(1)] }
  }
  const next = [entryFor(track, at), ...state.recent.filter((item) => item.id !== track.id)]
  return { ...state, recent: next.slice(0, RECENT_LIMIT) }
}

/**
 * Record one play in the detail log.
 *
 * Unlike the rail this keeps every listen, because the week view answers
 * "what did I play that day" rather than "what did I play last". A restart
 * inside `PLAY_DEDUP_MS` still refreshes the top row instead of appending:
 * auditioning a queue by skipping back and forth should not fill the day with
 * the same title.
 */
export function addPlay(state: HistoryState, track: Track, at: number): HistoryState {
  const latest = state.plays[0]
  if (latest && latest.id === track.id && at - latest.at < PLAY_DEDUP_MS) {
    return { ...state, plays: [{ ...latest, at }, ...state.plays.slice(1)] }
  }
  return { ...state, plays: [entryFor(track, at), ...state.plays].slice(0, PLAY_LIMIT) }
}

/**
 * Drop plays older than the retention window.
 *
 * Called when the store writes, not on every play: the filter walks the whole
 * log, and the log only needs trimming once in a while.
 */
export function prunePlays(state: HistoryState, at: number): HistoryState {
  const cutoff = at - PLAY_DAYS * 24 * 60 * 60 * 1000
  const plays = state.plays.filter((entry) => entry.at >= cutoff)
  return plays.length === state.plays.length ? state : { ...state, plays }
}

interface PlayDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  entries: PlayEntry[]
}

/**
 * Group plays into calendar days, newest day first.
 *
 * Repeated starts of the same track collapse to its newest row: a day that
 * lists 晚风 four times is a log, not a summary of what you listened to.
 * Order inside a day stays newest first, from the input order.
 */
export function groupPlaysByDay(plays: readonly PlayEntry[]): PlayDay[] {
  const buckets = new Map<string, PlayDay>()
  const days: PlayDay[] = []
  for (const entry of plays) {
    const key = dayKey(entry.at)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { day: key, entries: [] }
      buckets.set(key, bucket)
      days.push(bucket)
    }
    if (bucket.entries.some((item) => item.id === entry.id)) continue
    bucket.entries.push(entry)
  }
  return days
}

/**
 * Add listened seconds to today's bucket.
 *
 * `seconds` is whatever the engine actually observed, so pausing, seeking past
 * a section and skipping all behave sensibly without extra bookkeeping here.
 */
export function addSeconds(
  state: HistoryState,
  track: Track,
  seconds: number,
  at: number
): HistoryState {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return state
  const day = dayKey(at)
  const existing = state.days.find((item) => item.day === day)
  const base: DayStat = existing ?? { day, seconds: 0, trackIds: [], artists: {} }
  const artists = { ...base.artists }
  const artist = track.artist || '未知艺术家'
  artists[artist] = (artists[artist] ?? 0) + seconds
  const trackIds = base.trackIds.includes(track.id) ? base.trackIds : [...base.trackIds, track.id]
  const updated: DayStat = { day, seconds: base.seconds + seconds, trackIds, artists }
  const days = [updated, ...state.days.filter((item) => item.day !== day)]
  return { ...state, days: days.slice(0, DAY_LIMIT) }
}

export function dayStat(state: HistoryState, day: string): DayStat | null {
  return state.days.find((item) => item.day === day) ?? null
}

/** Headline numbers for the home page's "listening today" block. */
export function todaySummary(state: HistoryState, at: number): TodaySummary {
  const stat = dayStat(state, dayKey(at))
  if (!stat) return { seconds: 0, tracks: 0, topArtist: null, topArtistSeconds: 0 }
  let topArtist: string | null = null
  let topArtistSeconds = 0
  for (const [name, seconds] of Object.entries(stat.artists)) {
    if (seconds > topArtistSeconds) {
      topArtist = name
      topArtistSeconds = seconds
    }
  }
  return {
    seconds: stat.seconds,
    tracks: stat.trackIds.length,
    topArtist,
    topArtistSeconds
  }
}
