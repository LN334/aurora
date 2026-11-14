import fs from 'node:fs'
import { Readable } from 'node:stream'
import { parseRange } from '../pure/media-cache-rules'
import type { CachedAudio, MediaCache } from '../media-cache'
import { fetchUpstream, isAllowedHost } from './remote-protocol'

/**
 * `aurora-cache://` - the same audio the remote proxy serves, but read from the
 * local cache when the track has been played before.
 *
 * Why a second scheme instead of caching inside the remote proxy: the remote URL
 * is a signed CDN address that changes between plays, so it cannot be the cache
 * key. The renderer knows which provider and track it is asking for, and puts
 * that identity in the URL; the upstream address rides along as the fallback for
 * the first play. From then on the upstream part is never needed, which is what
 * makes the "no network on the second play" acceptance test possible.
 *
 * Electron is required lazily and only in `handleCacheProtocol`, for the same
 * reason `remote-protocol.ts` does it: a plain Node test process must be able to
 * import `handleCacheRequest` without an Electron runtime.
 */

export const CACHE_SCHEME = 'aurora-cache'

interface ElectronProtocol {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: Record<string, boolean> }[]): void
  handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void
}

function electronProtocol(): { protocol: ElectronProtocol } {
  return require('electron') as { protocol: ElectronProtocol }
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'accept-ranges': 'bytes'
}

const PREFLIGHT_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'content-range, content-length, accept-ranges',
  'access-control-max-age': '600'
}

/** Response headers worth keeping from the upstream answer; nothing else is. */
const PASSTHROUGH = ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']

/** In-flight background downloads, so one play does not start two of them. */
const pending = new Map<string, Promise<void>>()

/**
 * `aurora-cache://audio/<key>/<percent-encoded upstream URL>` -> both parts.
 *
 * The key is encoded as a single segment, and it contains a colon
 * (`netease:12345`), which `encodeURIComponent` leaves alone - safe in a path
 * segment and readable in a log line.
 */
function parseCacheTarget(url: URL): { key: string; upstream: string } | null {
  if (url.host !== 'audio') return null
  const raw = url.pathname.replace(/^\/+/, '')
  const slash = raw.indexOf('/')
  if (slash <= 0 || slash === raw.length - 1) return null
  const key = raw.slice(0, slash)
  const encoded = raw.slice(slash + 1)
  try {
    const upstream = new URL(decodeURIComponent(encoded))
    if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') return null
    return { key, upstream: upstream.toString() }
  } catch {
    return null
  }
}

function rangeHeaders(headers: Headers): void {
  headers.set('accept-ranges', 'bytes')
  headers.set('access-control-expose-headers', 'content-range, content-length, accept-ranges')
}

/** Serve a cached file, honouring one Range the way an `<audio>` element expects. */
async function cachedAudioResponse(entry: CachedAudio, request: Request): Promise<Response> {
  const headers = new Headers(CORS_HEADERS)
  headers.set('content-type', entry.type)
  /*
   * The file is a cache the app manages; letting Chromium keep a second copy in
   * its HTTP cache would make "clear cache" leave bytes behind.
   */
  headers.set('cache-control', 'no-store')
  rangeHeaders(headers)

  const range = parseRange(request.headers.get('range'), entry.size)
  if (range === 'invalid') {
    headers.set('content-range', `bytes */${entry.size}`)
    return new Response(null, { status: 416, headers })
  }

  const start = range ? range.start : 0
  const end = range ? range.end : entry.size - 1
  const length = end - start + 1
  headers.set('content-length', String(length))
  if (range) headers.set('content-range', `bytes ${start}-${end}/${entry.size}`)

  const status = range ? 206 : 200
  if (request.method === 'HEAD') return new Response(null, { status, headers })

  const body = Readable.toWeb(fs.createReadStream(entry.path, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status, headers })
}

/**
 * Fill the cache in the background while the current play streams from upstream.
 *
 * Deliberately a second request rather than a tee of the one the player is
 * reading: a tee dies with the first play-through (the user skips to the next
 * track at 0:30 and the download is cancelled with it), and the byte ranges a
 * player requests are not the whole file anyway. One extra request on the first
 * play buys a cache that is always a complete file.
 */
function fillCache(cache: MediaCache, key: string, upstream: string): void {
  if (pending.has(key)) return
  const task = (async () => {
    try {
      const response = await fetchUpstream(upstream, null)
      if (!response.ok || !response.body) return
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      // Some CDNs answer `binary/octet-stream`; the first bytes decide anyway,
      // so only a definitely-not-audio answer is refused here.
      if (type && !type.startsWith('audio/') && type !== 'application/octet-stream' && type !== 'binary/octet-stream') {
        return
      }
      await cache.store(key, response.body as unknown as AsyncIterable<Uint8Array>)
    } catch {
      /* a background cache fill must never surface as a playback failure */
    }
  })().finally(() => {
    pending.delete(key)
  })
  pending.set(key, task)
}

async function proxyUpstream(upstream: string, request: Request): Promise<Response> {
  const response = await fetchUpstream(upstream, request.headers.get('range'))
  const headers = new Headers(CORS_HEADERS)
  for (const name of PASSTHROUGH) {
    const value = response.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (!headers.has('content-type')) headers.set('content-type', 'audio/mpeg')
  headers.set('cache-control', 'no-store')
  rangeHeaders(headers)
  const noBody = request.method === 'HEAD' || response.status === 204 || response.status === 304
  return new Response(noBody ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

/**
 * One request, decoupled from the scheme registration so a probe or a test can
 * drive it directly.
 */
async function handleCacheRequest(request: Request, cache: MediaCache): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('bad url', { status: 400, headers: CORS_HEADERS })
  }

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: PREFLIGHT_HEADERS })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const target = parseCacheTarget(url)
  if (!target) return new Response('bad target', { status: 400, headers: CORS_HEADERS })

  // A hit never leaves the machine: no DNS check, no upstream request at all.
  const hit = await cache.lookup(target.key)
  if (hit) return cachedAudioResponse(hit, request)

  let hostname: string
  try {
    hostname = new URL(target.upstream).hostname
  } catch {
    return new Response('bad target', { status: 400, headers: CORS_HEADERS })
  }
  if (!(await isAllowedHost(hostname))) {
    return new Response('forbidden', { status: 403, headers: CORS_HEADERS })
  }

  fillCache(cache, target.key, target.upstream)
  try {
    return await proxyUpstream(target.upstream, request)
  } catch (error) {
    // The URL carries a signature; only the host goes into the log.
    console.error('[aurora] cached stream fallback failed', hostname, error)
    return new Response('upstream error', { status: 502, headers: CORS_HEADERS })
  }
}

export function registerCacheScheme(): void {
  const { protocol } = electronProtocol()
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CACHE_SCHEME,
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

export function handleCacheProtocol(cache: MediaCache): void {
  const { protocol } = electronProtocol()
  protocol.handle(CACHE_SCHEME, (request) => handleCacheRequest(request, cache))
}
