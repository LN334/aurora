import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  cacheLimitBytes,
  evictionsFor,
  sniffAudioType,
  type CacheFile
} from './pure/media-cache-rules.ts'

/**
 * Audio that has already been played once, kept on disk.
 *
 * The proxy in `protocols/remote-protocol.ts` already streams online audio
 * through the main process on every play, because the renderer is served from a
 * private origin with no external CSP allowances and Web Audio silences a
 * source it cannot read. That proxy is the natural place to also remember the
 * bytes: the song the user plays for the fifth time should come off the disk,
 * not off a signed CDN URL that expires in ten minutes.
 *
 * Two decisions worth naming:
 *
 * - The key is supplied by the caller (`provider:trackId`), never the upstream
 *   URL. Those URLs carry a signature and a timestamp, so keying on them would
 *   mean a fresh entry on every play and a cache that never hits.
 * - Writes land in a `.part` file and are renamed only once the whole track has
 *   arrived. A half-written file that looked like a hit would play 40 seconds of
 *   a song and then stop.
 *
 * Electron is not imported here at all: the directory comes from the caller,
 * which keeps this module testable from a plain `node --test` process.
 */

export interface CachedAudio {
  path: string
  size: number
  type: string
}

export interface MediaCacheStats {
  entries: number
  bytes: number
  limitBytes: number
  directory: string
}

export interface MediaCache {
  /** Everything needed to answer a `Range` request: a real file on disk. */
  lookup(key: string): Promise<CachedAudio | null>
  /**
   * Consume `body` into the cache. Returns whether the file was kept - a
   * download larger than the whole budget is dropped rather than allowed to
   * evict everything else.
   */
  store(key: string, body: AsyncIterable<Uint8Array>): Promise<boolean>
  sweep(): Promise<void>
  stats(): Promise<MediaCacheStats>
  clear(): Promise<void>
  /** Applies a new budget immediately, sweeping right away. */
  setLimit(megabytes: number): Promise<void>
  limitBytes(): number
}

const EXT = '.bin'
/** How long `stats()` may reuse the last directory walk, in ms. */
const STATS_TTL_MS = 3000
/** A track bigger than this is not something a music player should cache. */
const MAX_ENTRY_BYTES = 200 * 1024 * 1024

export function createMediaCache(directory: string, limitMegabytes = 2048): MediaCache {
  let limit = cacheLimitBytes(limitMegabytes)
  let ready: Promise<void> | null = null
  let statsCache: { at: number; value: MediaCacheStats } | null = null

  const ensure = (): Promise<void> => {
    if (!ready) {
      ready = fsp.mkdir(directory, { recursive: true }).then(
        () => undefined,
        () => undefined
      )
    }
    return ready
  }

  const fileOf = (key: string): string =>
    path.join(directory, crypto.createHash('sha1').update(key).digest('hex') + EXT)

  const walk = async (): Promise<CacheFile[]> => {
    await ensure()
    let names: string[]
    try {
      names = await fsp.readdir(directory)
    } catch {
      return []
    }
    const rows = await Promise.all(
      names
        .filter((name) => name.endsWith(EXT))
        .map(async (name) => {
          try {
            const info = await fsp.stat(path.join(directory, name))
            return { name, size: info.size, at: info.mtimeMs }
          } catch {
            return null
          }
        })
    )
    return rows.filter((row): row is CacheFile => row !== null)
  }

  const sweep = async (): Promise<void> => {
    const files = await walk()
    const total = files.reduce((sum, file) => sum + file.size, 0)
    if (total <= limit) return
    for (const name of evictionsFor(files, limit)) {
      await fsp.unlink(path.join(directory, name)).catch(() => undefined)
    }
    statsCache = null
  }

  return {
    async lookup(key: string): Promise<CachedAudio | null> {
      const target = fileOf(key)
      let info: fs.Stats
      try {
        info = await fsp.stat(target)
      } catch {
        return null
      }
      if (!info.isFile() || info.size <= 0) return null

      /*
       * 命中就刷新 mtime：这是 LRU 的「最近使用」。写入那一刻的 mtime 只在
       * 初次落盘时正确，之后每次播放都该重新计时，否则一首常听的歌会因为
       * 很早下载过而被先删。
       */
      const now = new Date()
      await fsp.utimes(target, now, now).catch(() => undefined)

      let type: string | null = null
      try {
        const head = Buffer.alloc(16)
        const handle = await fsp.open(target, 'r')
        try {
          const { bytesRead } = await handle.read(head, 0, head.byteLength, 0)
          type = sniffAudioType(head.subarray(0, bytesRead))
        } finally {
          await handle.close()
        }
      } catch {
        /* 嗅不出来就按 mp3 发，播放器按内容兜底 */
      }

      return { path: target, size: info.size, type: type ?? 'audio/mpeg' }
    },

    async store(key: string, body: AsyncIterable<Uint8Array>): Promise<boolean> {
      if (limit <= 0) return false
      await ensure()
      const target = fileOf(key)
      const part = target + '.part'
      let received = 0
      let handle: fsp.FileHandle | null = null
      try {
        handle = await fsp.open(part, 'w')
        for await (const chunk of body) {
          if (received + chunk.byteLength > MAX_ENTRY_BYTES) {
            await handle.close()
            handle = null
            await fsp.unlink(part).catch(() => undefined)
            return false
          }
          await handle.write(chunk)
          received += chunk.byteLength
        }
        // Close before the rename: on Windows a file that is still open cannot
        // be moved, and a dangling handle also leaks until the process ends.
        await handle.close()
        handle = null
      } catch {
        await handle?.close().catch(() => undefined)
        await fsp.unlink(part).catch(() => undefined)
        return false
      }

      if (received <= 0) {
        await fsp.unlink(part).catch(() => undefined)
        return false
      }

      // A single track that does not fit the budget is not worth evicting the
      // rest of the library for; it is simply not cached.
      if (received > limit) {
        await fsp.unlink(part).catch(() => undefined)
        return false
      }

      try {
        await fsp.rename(part, target)
      } catch {
        await fsp.unlink(part).catch(() => undefined)
        return false
      }
      statsCache = null
      await sweep()
      return true
    },

    sweep,

    async stats(): Promise<MediaCacheStats> {
      if (statsCache && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.value
      const files = await walk()
      const value: MediaCacheStats = {
        entries: files.length,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
        limitBytes: limit,
        directory
      }
      statsCache = { at: Date.now(), value }
      return value
    },

    async clear(): Promise<void> {
      statsCache = null
      let names: string[]
      try {
        names = await fsp.readdir(directory)
      } catch {
        return
      }
      await Promise.all(
        names.map((name) => fsp.unlink(path.join(directory, name)).catch(() => undefined))
      )
    },

    async setLimit(megabytes: number): Promise<void> {
      limit = cacheLimitBytes(megabytes)
      statsCache = null
      // A limit of zero is "off", which also means what is already on disk has
      // to go - evictionsFor clears everything when the budget is zero.
      await sweep()
    },

    limitBytes(): number {
      return limit
    }
  }
}
