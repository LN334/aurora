 interface LyricLine {
  /** Seconds from the start of the track. */
  time: number
  text: string
  /**
   * Word-level timings from an enhanced-LRC line, when the file has them.
   *
   * Only present when at least two segments carry their own `<mm:ss.xx>` tag:
   * one tagged segment is not "line sings itself", it is a badly tagged line.
   */
  words?: LyricWord[]
}

interface LyricWord {
  /** Seconds from the start of the track, offset already folded in. */
  time: number
  text: string
}

export interface Lyrics {
  lines: LyricLine[]
  /** Global offset in seconds, already folded into `lines[].time`. */
  offset: number
  title: string | null
  artist: string | null
  album: string | null
  by: string | null
  /** True when nothing usable was parsed. */
  empty: boolean
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const META_TAG = /^\[(ti|ar|al|by|offset):(.*)\]$/i
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g
/** 同一段时长写法在方括号与尖括号里都出现过，取值口径一致。 */
const TAG_PARTS = /(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?/

function tagSeconds(minutes: string, seconds: string, fractionRaw: string): number {
  // `.5` means 500ms, `.05` means 50ms, `.005` means 5ms.
  const fraction = fractionRaw ? Number.parseInt(fractionRaw, 10) / 10 ** fractionRaw.length : 0
  return Number.parseInt(minutes, 10) * 60 + Number.parseInt(seconds, 10) + fraction
}

/**
 * Split an enhanced-LRC line into word-level segments.
 *
 * The tags mark where the *following* text starts, so `a<0:1>b<0:2>c` gives
 * `a@0, b@1, c@2`. Text before the first tag belongs to the line itself and
 * keeps the line's own start time.
 */
function wordTimings(rest: string, lineTime: number): LyricWord[] {
  const pieces: Array<{ time: number | null; text: string }> = []
  let cursor = 0
  WORD_TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WORD_TAG.exec(rest)) !== null) {
    const parts = TAG_PARTS.exec(match[0])
    if (!parts) continue
    const before = rest.slice(cursor, match.index)
    if (before) pieces.push({ time: null, text: before })
    pieces.push({ time: tagSeconds(parts[1], parts[2], parts[3] ?? ''), text: '' })
    cursor = match.index + match[0].length
  }
  // 没有行内标签：这不是增强 LRC，整行当一个词。
  if (cursor === 0) return []
  const tail = rest.slice(cursor)
  if (tail) pieces.push({ time: null, text: tail })

  const words: LyricWord[] = []
  for (const piece of pieces) {
    if (piece.time !== null) {
      words.push({ time: piece.time, text: '' })
    } else if (words.length === 0) {
      words.push({ time: lineTime, text: piece.text })
    } else {
      words[words.length - 1].text += piece.text
    }
  }
  const kept = words.filter((word) => word.text.trim().length > 0)
  return kept.length >= 2 ? kept : []
}

/**
 * Parse an LRC file.
 *
 * Handles the parts real files actually contain: multiple timestamps on one
 * line (`[00:12.00][01:20.00]same text`), a signed `[offset:]` in milliseconds,
 * metadata tags, and enhanced-LRC word timings (stripped, since we highlight by
 * line rather than by syllable).
 *
 * Malformed timestamps are skipped rather than throwing: a partially broken
 * lyrics file should still show whatever it does have.
 */
export function parseLrc(raw: string): Lyrics {
  const lines: LyricLine[] = []
  let offsetMs = 0
  let title: string | null = null
  let artist: string | null = null
  let album: string | null = null
  let by: string | null = null

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const meta = META_TAG.exec(line)
    if (meta) {
      const key = meta[1].toLowerCase()
      const value = meta[2].trim()
      if (key === 'offset') {
        const parsed = Number.parseInt(value, 10)
        if (Number.isFinite(parsed)) offsetMs = parsed
      } else if (key === 'ti') title = value || null
      else if (key === 'ar') artist = value || null
      else if (key === 'al') album = value || null
      else if (key === 'by') by = value || null
      continue
    }

    TIME_TAG.lastIndex = 0
    const stamps: number[] = []
    let match: RegExpExecArray | null
    while ((match = TIME_TAG.exec(line)) !== null) {
      stamps.push(tagSeconds(match[1], match[2], match[3] ?? ''))
    }
    if (stamps.length === 0) continue

    const rest = line.replace(TIME_TAG, '')
    const text = rest.replace(WORD_TAG, '').trim()
    const words = wordTimings(rest, stamps[0])
    for (const time of stamps) {
      // 一行挂多个时间戳时，词的时间是同一份相对时间，各自复制一份。
      lines.push(words.length > 0 ? { time, text, words: words.map((word) => ({ ...word })) } : { time, text })
    }
  }

  const shift = offsetMs / 1000
  for (const line of lines) {
    line.time = Math.max(0, line.time - shift)
    if (line.words) {
      for (const word of line.words) word.time = Math.max(0, word.time - shift)
    }
  }
  lines.sort((a, b) => a.time - b.time)

  return {
    lines,
    offset: shift,
    title,
    artist,
    album,
    by,
    empty: lines.length === 0
  }
}

export function emptyLyrics(): Lyrics {
  return { lines: [], offset: 0, title: null, artist: null, album: null, by: null, empty: true }
}

/**
 * How many word segments have started at `position`.
 *
 * Same shape as `activeLineAt` and for the same reason: this is asked every
 * animation frame while a word-timed line is on screen.
 */
export function spokenWords(words: readonly LyricWord[], position: number): number {
  let low = 0
  let high = words.length - 1
  let found = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (words[mid].time <= position) {
      found = mid + 1
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/**
 * Index of the line that should be highlighted at `position`, or -1 before the
 * first line begins. Binary search: lyric lookups run on every animation frame.
 */
export function activeLineAt(lines: LyricLine[], position: number): number {
  if (lines.length === 0) return -1
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= position) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}
