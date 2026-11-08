import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * 封面磁盘缓存。
 *
 * 上游封面地址是稳定的（网易云 p1.music.126.net、QQ y.gtimg.cn、抖音 douyinpic），
 * 但 `aurora-remote://` 是自定义协议，Chromium 不把它写进 HTTP 磁盘缓存，于是每次
 * 冷启动都要把整个首屏的图重新拉一遍——这就是「打开页面封面半天不出来」的主因。
 *
 * 这里不依赖 Electron：目录由调用方给，测试可以传一个临时目录直接驱动。
 * 命中判断只看文件名，content-type 由扩展名反推，省一个索引文件。
 */

export interface CachedCover {
  body: Buffer
  type: string
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'image/bmp': '.bmp'
}

const TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
}

/** 内存里最多留这么多字节；超过就按最久未用丢掉一半。 */
const MEMORY_BUDGET = 48 * 1024 * 1024
/** 一张图超过这个大小就不进缓存（多半不是封面，而是整张大图）。 */
const MAX_ENTRY = 3 * 1024 * 1024

export interface CoverCache {
  get(key: string): Promise<CachedCover | null>
  put(key: string, body: Buffer, type: string): void
  stats(): { hits: number; misses: number; writes: number; memoryBytes: number }
}

export function createCoverCache(directory: string): CoverCache {
  const memory = new Map<string, CachedCover>()
  let memoryBytes = 0
  let hits = 0
  let misses = 0
  let writes = 0
  let ready: Promise<void> | null = null
  let pruned = 0

  const ensure = (): Promise<void> => {
    if (!ready) {
      ready = fs.promises.mkdir(directory, { recursive: true }).then(
        () => undefined,
        () => undefined
      )
    }
    return ready
  }

  const digest = (key: string): string => crypto.createHash('sha1').update(key).digest('hex')

  const remember = (key: string, entry: CachedCover): void => {
    if (memory.has(key)) {
      const old = memory.get(key)!
      memoryBytes -= old.body.byteLength
      memory.delete(key)
    }
    memory.set(key, entry)
    memoryBytes += entry.body.byteLength
    if (memoryBytes <= MEMORY_BUDGET) return
    // 粗略的 LRU：Map 保持插入顺序，从头删到预算以内。
    for (const [oldKey, oldValue] of memory) {
      if (memoryBytes <= MEMORY_BUDGET * 0.75) break
      memory.delete(oldKey)
      memoryBytes -= oldValue.body.byteLength
    }
  }

  /*
   * 清理只在写入时偶尔跑一次：目录大了以后 readdir 本身有成本，而封面缓存
   * 少一两次清理没有影响——旧文件留着只是占盘，不会读错。
   */
  const prune = async (): Promise<void> => {
    if (Date.now() - pruned < 10 * 60 * 1000) return
    pruned = Date.now()
    try {
      const names = await fs.promises.readdir(directory)
      if (names.length <= 4000) return
      const rows = await Promise.all(
        names.map(async (name) => {
          try {
            const info = await fs.promises.stat(path.join(directory, name))
            return { name, at: info.mtimeMs }
          } catch {
            return null
          }
        })
      )
      const live = rows.filter((row): row is { name: string; at: number } => row !== null)
      live.sort((a, b) => a.at - b.at)
      const drop = live.slice(0, Math.max(0, live.length - 3000))
      await Promise.all(
        drop.map((row) => fs.promises.unlink(path.join(directory, row.name)).catch(() => undefined))
      )
    } catch {
      /* 清理失败不影响读，下一次再试 */
    }
  }

  return {
    async get(key: string): Promise<CachedCover | null> {
      const warm = memory.get(key)
      if (warm) {
        hits += 1
        return warm
      }
      await ensure()
      const base = path.join(directory, digest(key))
      for (const [ext, type] of Object.entries(TYPE_BY_EXT)) {
        try {
          const body = await fs.promises.readFile(base + ext)
          const entry = { body, type }
          remember(key, entry)
          hits += 1
          return entry
        } catch {
          /* 换下一个扩展名 */
        }
      }
      misses += 1
      return null
    },

    put(key: string, body: Buffer, type: string): void {
      const normalized = type.split(';')[0].trim().toLowerCase()
      const ext = EXT_BY_TYPE[normalized]
      if (!ext || body.byteLength === 0 || body.byteLength > MAX_ENTRY) return
      remember(key, { body, type: normalized })
      writes += 1
      void (async () => {
        await ensure()
        const base = path.join(directory, digest(key))
        const temp = base + '.' + process.pid + '.tmp'
        try {
          await fs.promises.writeFile(temp, body)
          await fs.promises.rename(temp, base + ext)
        } catch {
          await fs.promises.unlink(temp).catch(() => undefined)
        }
        void prune()
      })()
    },

    stats() {
      return { hits, misses, writes, memoryBytes }
    }
  }
}
