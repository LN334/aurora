import { nativeImage, protocol } from 'electron'
import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import fs from 'node:fs'
import path from 'node:path'
import { isInsideRoots } from '../settings'
import { readEmbeddedArt, readFolderArt } from '../library-scan'

export const MEDIA_SCHEME = 'aurora-media'

/**
 * A private, standard, secure scheme for local media.
 *
 * Why not `file://`: the renderer runs on `http://127.0.0.1:5173` in dev and
 * `file://` in production, and `<audio>` routed through Web Audio outputs
 * silence for cross-origin sources. Serving from one scheme with CORS headers
 * makes the origin relationship explicit and identical in both modes.
 *
 * `stream: true` is what allows range requests, and therefore seeking.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wv': 'audio/x-wavpack',
  '.ape': 'audio/x-ape',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}

function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

const CORS = {
  // Without this the Web Audio graph receives silence instead of samples.
  'access-control-allow-origin': '*',
  'accept-ranges': 'bytes'
}

/**
 * Stream a file range rather than buffering it. A lossless album can be
 * hundreds of megabytes, and Chromium issues a range request per seek, so
 * reading whole files into memory per request would be both slow and dangerous.
 */
function bodyOf(file: string, start?: number, end?: number): WebReadableStream {
  const stream = fs.createReadStream(file, start === undefined ? undefined : { start, end })
  return Readable.toWeb(stream) as WebReadableStream
}

async function serveAudio(target: string, request: Request): Promise<Response> {
  if (!isInsideRoots(target)) return new Response('forbidden', { status: 403 })

  let size: number
  try {
    const stat = await fs.promises.stat(target)
    if (!stat.isFile()) return new Response('not a file', { status: 404 })
    size = stat.size
  } catch {
    return new Response('not found', { status: 404 })
  }

  const type = mimeFor(target)
  const range = request.headers.get('range')

  if (!range) {
    return new Response(bodyOf(target), {
      status: 200,
      headers: { ...CORS, 'content-type': type, 'content-length': String(size) }
    })
  }

  // `bytes=start-end`, where either side may be omitted.
  const match = /bytes=(\d*)-(\d*)/.exec(range)
  if (!match || (match[1] === '' && match[2] === '')) {
    return new Response(null, {
      status: 416,
      headers: { ...CORS, 'content-range': `bytes */${size}` }
    })
  }

  let start: number
  let end: number
  if (match[1] === '') {
    // Suffix range: the last N bytes.
    const suffix = Number.parseInt(match[2], 10)
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number.parseInt(match[1], 10)
    end = match[2] === '' ? size - 1 : Math.min(Number.parseInt(match[2], 10), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return new Response(null, {
      status: 416,
      headers: { ...CORS, 'content-range': `bytes */${size}` }
    })
  }

  return new Response(bodyOf(target, start, end), {
    status: 206,
    headers: {
      ...CORS,
      'content-type': type,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${size}`
    }
  })
}

/**
 * 本机封面的缩略图。
 *
 * 内嵌封面常见 1000×1000 或更大，而列表行只显示 40px、卡片两三百像素。
 * 原图直出意味着每张图解码后占 4 MB 位图——收藏页几百行就是几百兆常驻，
 * 而屏幕上根本看不出区别。
 *
 * 这里用 Electron 自带的 nativeImage 在主进程缩一次再发；结果按「路径@边长」
 * 缓存，同一张图被多个尺寸要过的场景也不会重复解码。缓存上限 400 条，满了
 * 整批清掉——这只是给一次滚动用的短期缓存，不必做 LRU。
 */
const thumbCache = new Map<string, Buffer>()

function thumbOf(key: string, data: Buffer, px: number): Buffer | null {
  const hit = thumbCache.get(key)
  if (hit) return hit
  try {
    const image = nativeImage.createFromBuffer(data)
    if (image.isEmpty()) return null
    const size = image.getSize()
    // 原图本来就比要的还小：直接用，不放大。
    if (Math.max(size.width, size.height) <= px) {
      thumbCache.set(key, data)
      return data
    }
    const out = image.resize({ width: px, quality: 'good' }).toJPEG(84)
    if (thumbCache.size > 400) thumbCache.clear()
    thumbCache.set(key, out)
    return out
  } catch {
    return null
  }
}

async function serveArt(target: string, px?: number): Promise<Response> {
  if (!isInsideRoots(target)) return new Response('forbidden', { status: 403 })

  // Embedded picture first, then a folder image beside the file.
  const embedded = await readEmbeddedArt(target)
  if (embedded) {
    const small = px ? thumbOf(target + '@' + px, embedded.data, px) : null
    return new Response(new Uint8Array(small ?? embedded.data), {
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'content-type': small ? 'image/jpeg' : embedded.mime,
        'cache-control': 'no-store'
      }
    })
  }

  const folderImage = await readFolderArt(target)
  if (folderImage) {
    try {
      const data = await fs.promises.readFile(folderImage)
      const small = px ? thumbOf(folderImage + '@' + px, data, px) : null
      return new Response(new Uint8Array(small ?? data), {
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': small ? 'image/jpeg' : mimeFor(folderImage),
          'cache-control': 'no-store'
        }
      })
    } catch {
      /* fall through to 404 */
    }
  }

  return new Response('no artwork', { status: 404 })
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('bad url', { status: 400 })
    }

    const decoded = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    /*
     * 本地封面的地址可以是 `/<边长>/<路径>`：第一段是纯数字就当作缩略尺寸。
     * 真实文件路径以盘符开头（`C:\\…`），不会长成这样，所以不会误判。
     */
    const sized = /^(\d{2,4})\/([\s\S]+)$/.exec(decoded)
    const px = sized ? Number(sized[1]) : undefined
    const target = sized ? sized[2] : decoded
    if (!target) return new Response('bad request', { status: 400 })

    try {
      if (url.host === 'art') return await serveArt(target, px)
      if (url.host === 'file') return await serveAudio(target, request)
    } catch (error) {
      console.error('[aurora] media protocol failed', target, error)
      return new Response('internal error', { status: 500 })
    }
    return new Response('not found', { status: 404 })
  })
}
