/**
 * Rules behind the on-disk audio cache.
 *
 * Kept pure and separate from the file system for one reason: the interesting
 * decisions here are "which byte range does this request want" and "which old
 * file goes when the folder is over budget". Both are easy to get subtly wrong
 * - an off-by-one in a range shows up as a track that skips a fraction of a
 * second, an eviction that ignores mtime deletes the song playing right now -
 * and both are cheap to pin down with unit tests once nothing touches disk.
 */

/** A cached file as the sweep sees it. */
export interface CacheFile {
  name: string
  size: number
  /** Last use, epoch ms (the file's mtime). */
  at: number
}

const CACHE_LIMIT_MIN_MB = 0
const CACHE_LIMIT_MAX_MB = 10_240

/** Sweep down to 90% of the cap, not to the cap itself. */
const SWEEP_TARGET = 0.9

/**
 * Megabytes as the settings page speaks them, turned into bytes.
 *
 * Zero means "do not cache", which is a real choice on a small disk and must
 * survive the conversion rather than be rounded up to a token amount.
 */
export function cacheLimitBytes(megabytes: number): number {
  if (!Number.isFinite(megabytes)) return 0
  const clamped = Math.min(CACHE_LIMIT_MAX_MB, Math.max(CACHE_LIMIT_MIN_MB, Math.round(megabytes)))
  return clamped * 1024 * 1024
}

/**
 * Content type from the first bytes of a file.
 *
 * The cache stores the bytes the platform sent, and that is not always what its
 * `content-type` header claimed - some CDNs answer `audio/mpeg` for an AAC
 * stream. Sniffing the container means a cached file is served as what it
 * actually is, which is also what the <audio> element needs to pick a decoder.
 */
export function sniffAudioType(head: Uint8Array): string | null {
  const ascii = (from: number, to: number): string => {
    let text = ''
    for (let index = from; index < to && index < head.length; index += 1) text += String.fromCharCode(head[index]!)
    return text
  }

  if (head.length >= 3 && ascii(0, 3) === 'ID3') return 'audio/mpeg'
  if (head.length >= 4 && ascii(0, 4) === 'fLaC') return 'audio/flac'
  if (head.length >= 4 && ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (head.length >= 4 && ascii(0, 4) === 'ADIF') return 'audio/aac'
  if (head.length >= 4 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav'
  if (head.length >= 8 && ascii(4, 8) === 'ftyp') return 'audio/mp4'

  // MPEG audio frame sync: eleven set bits, then the layer bits must not be
  // "reserved". AAC in ADTS also starts with 0xFFF, which the layer check
  // separates - 0xF1/0xF9 are ADTS, 0xFB/0xFA are MPEG audio.
  if (head.length >= 2 && head[0] === 0xff) {
    const second = head[1]!
    if ((second & 0xe0) === 0xe0) {
      const layer = (second >> 1) & 0x03
      return layer === 0 ? 'audio/aac' : 'audio/mpeg'
    }
  }

  return null
}

interface RangeSlice {
  start: number
  end: number
}

/**
 * Parse one `Range: bytes=…` header against a known file size.
 *
 * Returns `null` when there is no range (serve the whole file), a slice for a
 * satisfiable one, and the string `'invalid'` for anything unsatisfiable - the
 * caller answers that with 416, and guessing a range instead would hand the
 * player the middle of a song without telling it.
 *
 * Multi-range requests take their first range. Players never send one, and
 * multipart/byteranges is a second encoding path worth not having.
 */
export function parseRange(header: string | null, size: number): RangeSlice | null | 'invalid' {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)(?:,.*)?$/.exec(header.trim())
  if (!match) return 'invalid'
  const [, rawStart = '', rawEnd = ''] = match
  if (!rawStart && !rawEnd) return 'invalid'

  if (!rawStart) {
    // `bytes=-500`: the last 500 bytes.
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid'
    if (size === 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return 'invalid'
  if (!rawEnd) return { start, end: size - 1 }

  const end = Number(rawEnd)
  if (!Number.isFinite(end) || end < start) return 'invalid'
  // A range that runs past the end is clamped rather than refused; that is what
  // every web server does and what a player expects when it guesses a size.
  return { start, end: Math.min(end, size - 1) }
}

/**
 * Which files to delete so the folder is back under budget.
 *
 * Oldest first, and never the file that was just written — the sweep runs right
 * after a store, and a single track larger than the whole allowance would
 * otherwise delete itself before it was ever played twice.
 */
export function evictionsFor(files: readonly CacheFile[], limitBytes: number, keep?: string): string[] {
  const total = files.reduce((sum, file) => sum + file.size, 0)
  if (total <= limitBytes) return []

  /*
   * 上限为 0 是「不缓存」，不是「不清理」：这个值必须把所有旧文件清掉，否则
   * 关掉缓存之后磁盘上那几 GB 会一直躺在那儿，用户以为按钮生效了。
   */
  const target = limitBytes <= 0 ? 0 : Math.floor(limitBytes * SWEEP_TARGET)
  const ordered = files
    .filter((file) => file.name !== keep)
    .slice()
    .sort((left, right) => left.at - right.at || left.name.localeCompare(right.name))

  const removed: string[] = []
  let remaining = total
  for (const file of ordered) {
    if (remaining <= target) break
    removed.push(file.name)
    remaining -= file.size
  }
  return removed
}
