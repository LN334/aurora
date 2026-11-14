import { app, net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeName, pickBest, type TrackFacts } from './pure/lyrics-match'

/**
 * Online lyric lookup against LRCLIB (lrclib.net).
 *
 * LRCLIB is an open, community-run lyrics database that publishes a documented
 * public API and asks for no credentials. That is why it is the one online lyric
 * source here: unlike a commercial streaming platform's undocumented endpoints,
 * this is a service that exists to be queried.
 *
 * Default-off. Aurora's promise is that the library stays on the machine, and a
 * lyric lookup necessarily sends the track title and artist to a third party, so
 * the user turns it on rather than discovering it afterwards.
 *
 * Results are cached on disk, which makes a second play instant and keeps the
 * lyrics readable offline.
 */

export interface LyricsQuery {
  title: string
  artist: string
  album: string
  /** Seconds; LRCLIB matches on this, so an accurate duration matters. */
  duration: number
}

export interface LyricsHit {
  text: string
  /** Where this result came from, so the UI can say so honestly. */
  origin: 'cache' | 'lrclib'
  trackName: string
  artistName: string
  synced: boolean
}

const REQUEST_TIMEOUT_MS = 9000
const CACHE_LIMIT_BYTES = 4 * 1024 * 1024

const cacheDir = (): string => path.join(app.getPath('userData'), 'lyrics-cache')

function cacheKey(query: LyricsQuery): string {
  const raw = `${query.artist}\u0000${query.title}\u0000${Math.round(query.duration)}`
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 16777619)
    h2 = Math.imul(h2 + code, 2246822519)
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`
}

function cacheFile(query: LyricsQuery, extension: string): string {
  return path.join(cacheDir(), `${cacheKey(query)}${extension}`)
}

function readCache(query: LyricsQuery): LyricsHit | null {
  for (const extension of ['.lrc', '.txt']) {
    const file = cacheFile(query, extension)
    try {
      const text = fs.readFileSync(file, 'utf8')
      if (!text.trim()) continue
      return {
        text,
        origin: 'cache',
        trackName: query.title,
        artistName: query.artist,
        synced: extension === '.lrc'
      }
    } catch {
      /* not cached under this extension */
    }
  }
  return null
}

function writeCache(query: LyricsQuery, text: string, synced: boolean): void {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true })
    // One extension per shape: the `.lrc` reader only understands timestamps.
    const file = cacheFile(query, synced ? '.lrc' : '.txt')
    fs.writeFileSync(file, text, 'utf8')
    pruneCache()
  } catch (error) {
    console.error('[aurora] could not cache lyrics', error)
  }
}

/** Keep the cache from growing without bound across years of listening. */
function pruneCache(): void {
  try {
    const dir = cacheDir()
    const entries = fs
      .readdirSync(dir)
      .map((name) => {
        const full = path.join(dir, name)
        const stat = fs.statSync(full)
        return { full, size: stat.size, atime: stat.atimeMs }
      })
      .sort((a, b) => b.atime - a.atime)

    let total = 0
    for (const entry of entries) {
      total += entry.size
      if (total > CACHE_LIMIT_BYTES) fs.rmSync(entry.full, { force: true })
    }
  } catch {
    /* pruning is best-effort */
  }
}

interface LrclibRecord {
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
  instrumental?: boolean
  plainLyrics?: string | null
  syncedLyrics?: string | null
}

function factsOf(record: LrclibRecord): TrackFacts {
  return {
    title: record.trackName ?? '',
    artist: record.artistName ?? '',
    album: record.albumName ?? '',
    duration: record.duration ?? 0
  }
}

async function request(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await net.fetch(url, {
      headers: {
        // LRCLIB asks clients to identify themselves.
        'user-agent': `Aurora/${app.getVersion()} (https://github.com/; desktop music player)`,
        accept: 'application/json'
      },
      signal: controller.signal
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function toHit(record: LrclibRecord | null | undefined): LyricsHit | null {
  if (!record || record.instrumental) return null

  // Prefer the synchronised version: it drives the lyric stage line by line.
  const synced = (record.syncedLyrics ?? '').trim()
  if (synced) {
    return {
      text: synced,
      origin: 'lrclib',
      trackName: record.trackName ?? '',
      artistName: record.artistName ?? '',
      synced: true
    }
  }

  const plain = (record.plainLyrics ?? '').trim()
  if (!plain) return null

  /*
   * Wrap unsynchronised text in a synthetic LRC. Without timings there is no
   * honest way to highlight a line, so every line is given the same timestamp
   * and the stage shows the text as a block rather than pretending to follow it.
   */
  const stamped = plain
    .split(/\r?\n/)
    .map((line) => `[00:00.00]${line}`)
    .join('\n')

  return {
    text: stamped,
    origin: 'lrclib',
    trackName: record.trackName ?? '',
    artistName: record.artistName ?? '',
    synced: false
  }
}

/**
 * One exact lookup, retried once with the name folded to a canonical spelling.
 *
 * `api/get` is an exact match on the title, so 「（晴天）」 with a full-width
 * bracket, a curly apostrophe, or a traditional character set that the file's
 * tagger kept never reaches the row that exists. Folding is cheap and only runs
 * when it actually changes the query.
 */
async function lookupExact(facts: TrackFacts): Promise<LyricsHit | null> {
  const attempts: TrackFacts[] = [{ ...facts }]
  const folded: TrackFacts = {
    title: normalizeName(facts.title),
    artist: normalizeName(facts.artist),
    album: normalizeName(facts.album ?? ''),
    duration: facts.duration
  }
  if (
    folded.title !== facts.title ||
    folded.artist !== facts.artist ||
    (folded.album ?? '') !== (facts.album ?? '')
  ) {
    attempts.push(folded)
  }

  for (const attempt of attempts) {
    if (!attempt.title) continue
    const url = new URL('https://lrclib.net/api/get')
    url.searchParams.set('track_name', attempt.title)
    if (attempt.artist && attempt.artist !== '未知艺术家') {
      url.searchParams.set('artist_name', attempt.artist)
    }
    if (attempt.album) url.searchParams.set('album_name', attempt.album)
    if (attempt.duration && attempt.duration > 0) {
      url.searchParams.set('duration', String(attempt.duration))
    }

    const hit = toHit((await request(url.toString())) as LrclibRecord | null)
    if (hit) return hit
  }
  return null
}

/**
 * Look up lyrics for a track. Never throws: a lookup failure is an ordinary
 * outcome (offline, unknown track) and must not disturb playback.
 */
export async function lookupLyrics(query: LyricsQuery): Promise<LyricsHit | null> {
  const cached = readCache(query)
  if (cached) return cached

  const facts: TrackFacts = {
    title: query.title.trim(),
    artist: query.artist.trim(),
    album: query.album.trim(),
    duration: Math.round(query.duration)
  }
  if (!facts.title) return null

  const exact = await lookupExact(facts)
  if (exact) {
    writeCache(query, exact.text, exact.synced)
    return exact
  }

  // Fall back to search: tags rarely match LRCLIB's spelling exactly, and an
  // exact-duration lookup misses on any rip whose duration is off by a second.
  const search = new URL('https://lrclib.net/api/search')
  search.searchParams.set('track_name', facts.title)
  if (facts.artist && facts.artist !== '未知艺术家') {
    search.searchParams.set('artist_name', facts.artist)
  }

  const results = (await request(search.toString())) as LrclibRecord[] | null
  if (!Array.isArray(results)) return null

  const candidates = results
    .map((record) => ({ record, hit: toHit(record) }))
    .filter((entry): entry is { record: LrclibRecord; hit: LyricsHit } => entry.hit !== null)

  /*
   * Search answers with every row that shares a word with the query, so the
   * ranking decides the result. Score each row on what identifies a recording
   * (see pure/lyrics-match.ts) and refuse anything below the threshold: showing
   * the lyrics of a different song because its duration was close is worse than
   * showing nothing.
   *
   * The sort below only breaks ties. `pickBest` keeps the earlier candidate on
   * equal scores, so synchronised rows go first and win a tie.
   */
  const ordered = candidates
    .slice()
    .sort((left, right) => Number(right.hit.synced) - Number(left.hit.synced))
  const best = pickBest(ordered, facts, (entry) => factsOf(entry.record))
  if (!best) return null

  writeCache(query, best.item.hit.text, best.item.hit.synced)
  return best.item.hit
}
