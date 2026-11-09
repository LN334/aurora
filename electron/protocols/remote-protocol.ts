import crypto from 'node:crypto'
import dns from 'node:dns'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/**
 * A private, standard, secure scheme for media that lives on someone else's
 * server.
 *
 * Why proxy at all: the production renderer is served from `aurora-app://app`
 * with a CSP that allows no external origin, and the player routes its element
 * through Web Audio, which outputs silence for any source the page is not
 * allowed to read. Both problems have the same fix - the main process fetches
 * the upstream address and re-serves it from this app's own origin, with the
 * CORS and range behaviour an `<audio>` element and the Web Audio graph expect.
 *
 * `stream: true` is what allows range requests, and `corsEnabled` is what makes
 * `crossOrigin="anonymous"` succeed; without either, seeking breaks or the
 * output is silent. The privileges must be registered before `app.ready`, so
 * this runs next to `registerMediaScheme()` in `main.ts`.
 *
 * Electron is loaded lazily, in `handleRemoteProtocol` only. That keeps this
 * module importable from a plain Node process - the smoke probe and the unit
 * tests drive `handleRemoteRequest` and the address checks directly, and an
 * `electron` import that resolves to a path string at the top would break both.
 */

export const REMOTE_SCHEME = 'aurora-remote'

export function registerRemoteScheme(): void {
  const { protocol } = electronProtocol()
  protocol.registerSchemesAsPrivileged([
    {
      scheme: REMOTE_SCHEME,
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

/** The slice of Electron's protocol module this file uses. */
interface ElectronProtocol {
  registerSchemesAsPrivileged(schemes: { scheme: string; privileges: Record<string, boolean> }[]): void
  handle(scheme: string, handler: (request: Request) => Promise<Response> | Response): void
}

function electronProtocol(): { protocol: ElectronProtocol } {
  return require('electron') as { protocol: ElectronProtocol }
}

const CORS_HEADERS: Record<string, string> = {
  // Web Audio refuses to read a source it cannot CORS-check, and a refused read
  // is silence rather than an error - the worst kind of bug to debug.
  'access-control-allow-origin': '*',
  'accept-ranges': 'bytes'
}

/** A Range request is a CORS-preflighted one once a scheme is corsEnabled. */
const PREFLIGHT_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'range',
  'access-control-expose-headers': 'content-range, content-length, accept-ranges',
  'access-control-max-age': '600'
}

/** Response headers worth keeping; upstream's CSP and cookies are not. */
const PASSTHROUGH = ['content-type', 'content-length', 'content-range', 'etag', 'last-modified']

/**
 * Addresses this proxy must never reach.
 *
 * The renderer decides which upstream URL to ask for, so without this check the
 * scheme is a general-purpose request forwarder inside the user's network - a
 * router admin page, a NAS, or the cloud metadata endpoint on 169.254.169.254.
 * The ranges below are the usual "somewhere private" set; 224/4 and 0/8 are
 * included because they are never a music CDN either.
 */
export function isPrivateAddress(address: string): boolean {
  const version = net.isIP(address)

  if (version === 4) {
    const [a, b] = address.split('.').map(Number)
    if (a === 0 || a === 127 || a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    // Carrier-grade NAT, which is still somebody's private network.
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }

  if (version === 6) {
    const lower = address.toLowerCase()
    if (lower === '::' || lower === '::1') return true
    if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true

    /*
     * Three ways IPv6 carries an IPv4 address inside it, all of which can point
     * at the local network:
     *
     *   ::ffff:a.b.c.d  IPv4-mapped
     *   64:ff9b::a.b.c.d NAT64 well-known prefix
     *   2002:AABB:CCDD:: 6to4, where AABB:CCDD is the IPv4 address
     *   ::a.b.c.d       the deprecated IPv4-compatible form
     *
     * The URL parser rewrites the mapped form into hex - `http://[::ffff:127.0.0.1]`
     * arrives as `::ffff:7f00:1` - so matching only the dotted spelling let
     * loopback, 10/8 and 192.168/16 through a door the renderer can open on
     * purpose. Both spellings are decoded here, and anything embedded that
     * cannot be decoded is refused rather than assumed public.
     */
    const embedded =
      /^::ffff:(.+)$/.exec(lower)?.[1] ??
      /^64:ff9b::(.+)$/.exec(lower)?.[1] ??
      /^2002:([0-9a-f]{1,4}:[0-9a-f]{1,4})/.exec(lower)?.[1] ??
      // The deprecated IPv4-compatible form, `::127.0.0.1` = `::7f00:1`. `::1`
      // is loopback and caught above, so only the two-group form is left here.
      /^::([0-9a-f]{1,4}:[0-9a-f]{1,4})$/.exec(lower)?.[1] ??
      null
    if (embedded) {
      const dotted = dottedQuadOf(embedded)
      return dotted ? isPrivateAddress(dotted) : true
    }
    return false
  }

  // Not an IP literal at all: refuse rather than guess.
  return true
}

/**
 * `7f00:1` or `127.0.0.1` -> `127.0.0.1`, or null when it is neither.
 *
 * The hex pair is the same 32 bits the dotted form spells out, which is the
 * whole trick behind the bypass this helper exists to close.
 */
function dottedQuadOf(embedded: string): string | null {
  if (net.isIP(embedded) === 4) return embedded
  const pair = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(embedded)
  if (!pair) return null
  const high = Number.parseInt(pair[1], 16)
  const low = Number.parseInt(pair[2], 16)
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

/**
 * Host decisions are cached for a minute.
 *
 * A seek costs several range requests, and resolving the same CDN name for each
 * one would add a DNS round trip to every scrub. The TTL keeps the cache from
 * outliving a DNS change for long.
 */
const hostVerdicts = new Map<string, { allowed: boolean; at: number }>()
const HOST_TTL_MS = 60_000

/**
 * Whether a hostname (a literal address or a name) may be fetched.
 *
 * Exported for the unit tests, which check the private-range refusals without
 * touching the network. Note that this resolves names: a public name pointing
 * at 127.0.0.1 is exactly the case a literal-only check would miss.
 */
 async function isAllowedHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false

  const cached = hostVerdicts.get(host)
  if (cached && Date.now() - cached.at < HOST_TTL_MS) return cached.allowed

  let allowed = true
  if (net.isIP(host)) {
    allowed = !isPrivateAddress(host)
  } else {
    try {
      // A public name that resolves to a private address is still a private
      // address; checking the literal alone would only catch the naive case.
      const addresses = await dns.promises.lookup(host, { all: true })
      allowed = addresses.every((entry) => !isPrivateAddress(entry.address))
    } catch {
      allowed = false
    }
  }

  hostVerdicts.set(host, { allowed, at: Date.now() })
  return allowed
}

interface ResolvedTarget {
  target: string
  /** 0 表示不缩、直接给原图——播放器封面和舞台要的是这张。 */
  px: number
}

/** `aurora-remote://stream/<percent-encoded http(s) URL>` -> the upstream URL. */
function targetOf(url: URL): ResolvedTarget | null {
  let encoded = url.pathname.replace(/^\/+/, '')
  let px = 0
  /*
   * 形如 `image/n96/<percent-encoded URL>`：列表缩略图走这条。尺寸放在路径
   * 最前面而不是查询串里，是因为上游地址本身已经编码成一段，再叠参数容易和
   * 它自带的 `?` 撞上。
   */
  const sized = /^n(\d{2,4})\/(.+)$/.exec(encoded)
  if (sized) {
    px = Number(sized[1])
    encoded = sized[2]
  }
  if (!encoded) return null
  try {
    const target = new URL(decodeURIComponent(encoded))
    // Anything but plain web traffic is a different protocol smuggled through
    // a URL parser - `file:`, `data:`, `ftp:` - and has no business here.
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
    return { target: target.toString(), px }
  } catch {
    return null
  }
}

/** How many hops a stream may be bounced through before we give up. */
const MAX_REDIRECTS = 4

/**
 * Fetch upstream, re-checking the host on every hop.
 *
 * `redirect: 'follow'` would be one line shorter and would also hand the whole
 * protection away: any public host that answers 302 with `Location:
 * http://127.0.0.1/…` would have already been fetched by the time we saw the
 * response. Following manually keeps every hop behind `isAllowedHost`.
 *
 * One residual hole worth naming: the host check resolves DNS, and the fetch
 * resolves it again, so a name that answers "public" then "private" between the
 * two (DNS rebinding) is not caught. Closing that needs a pinned-address
 * dispatcher; the renderer is our own code and this guard is the second line,
 * not the first.
 */
/**
 * 上游请求头。
 *
 * 有的图床按 UA 与来源站防盗链：汽水的封面挂在 douyinpic 上，光带 range 过去
 * 一律 403，页面里就是一张空卡。这里统一补一个浏览器 UA，抖音系再带上来源站。
 */
function upstreamHeaders(target: string, range: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  }
  try {
    const host = new URL(target).hostname
    if (host.endsWith('douyinpic.com') || host.endsWith('douyincdn.com')) {
      headers.referer = 'https://www.douyin.com/'
    }
  } catch {
    /* 解析不了的地址交给后面的 fetch 去报错 */
  }
  if (range) headers.range = range
  return headers
}

async function fetchUpstream(target: string, range: string | null): Promise<Response> {
  let current = target

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      // Forwarding the range rather than the whole file is what makes seeking
      // work: a lossless track is tens of megabytes and the player wants 4KB of
      // it at a time.
      headers: upstreamHeaders(current, range),
      redirect: 'manual'
    })

    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return response

    // Release the redirect's own (empty) body, or the socket sits until GC.
    try {
      await response.body?.cancel()
    } catch {
      /* a body that cannot be cancelled is not worth failing the request over */
    }

    const next = new URL(location, current)
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      return new Response('bad redirect', { status: 400, headers: CORS_HEADERS })
    }
    if (!(await isAllowedHost(next.hostname))) {
      return new Response('forbidden', { status: 403, headers: CORS_HEADERS })
    }
    current = next.toString()
  }

  return new Response('too many redirects', { status: 502, headers: CORS_HEADERS })
}

async function proxy(target: string, request: Request, image: boolean): Promise<Response> {
  const upstream = await fetchUpstream(target, request.headers.get('range'))

  const headers = new Headers(CORS_HEADERS)
  for (const name of PASSTHROUGH) {
    const value = upstream.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (!headers.has('content-type')) {
    headers.set('content-type', image ? 'image/jpeg' : 'audio/mpeg')
  }
  // Cover URLs are stable; stream URLs are signed and expire, so caching one
  // past its lifetime would serve a 403 from a stale entry.
  headers.set('cache-control', image ? 'public, max-age=86400' : 'no-store')
  // The renderer needs `content-range` to size a seek, and it is not readable
  // from a cross-origin response unless it is exposed.
  headers.set('access-control-expose-headers', 'content-range, content-length, accept-ranges')

  const noBody = request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304
  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  })
}

/* ---------------------------------------------------------------------------
 * 封面缓存与并发闸门
 *
 * 自定义协议不进 Chromium 的 HTTP 磁盘缓存，冷启动一次要把首屏几十张封面全部
 * 重新拉一遍。这里在主进程做两层缓存（内存 + userData 下的文件），并把并发压在
 * 6 个以内：同时开几十条 TCP 去抢同一家 CDN，单张反而更慢。
 * ------------------------------------------------------------------------- */

/*
 * 12 而不是 6。
 *
 * 首屏一屏二十几张封面，6 并发时后面那批要等前一批整个往返结束；这张网的
 * 单张往返在 150–400ms，6 个名额意味着首屏最后一行要等将近两秒。这些请求
 * 打在完全不同的 CDN 主机上，彼此不抢连接，翻倍后首屏基本是一批出完。
 * 上限不再往上抬是因为上游图床对同源并发有阈值，再多就开始 403。
 */
const IMAGE_PARALLEL = 12
let imageActive = 0
const imageWaiters: (() => void)[] = []

function acquireImage(): Promise<void> {
  if (imageActive < IMAGE_PARALLEL) {
    imageActive += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => imageWaiters.push(resolve))
}

function releaseImage(): void {
  const next = imageWaiters.shift()
  // 有等待者就把名额直接转交，活跃计数不变。
  if (next) next()
  else imageActive -= 1
}

/*
 * 下面这段封面缓存原本是 protocols 目录里单独一个模块。并进本文件是因为
 * `node --test` 直接跑 .ts 时会按 ESM 解析无扩展名的相对 import，报
 * ERR_MODULE_NOT_FOUND；改成带 .ts 的路径又过不了 nodenext 的编译。
 */
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

interface CachedCover {
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

interface CoverCache {
  get(key: string): Promise<CachedCover | null>
  put(key: string, body: Buffer, type: string): void
  stats(): { hits: number; misses: number; writes: number; memoryBytes: number }
}

function createCoverCache(directory: string): CoverCache {
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

const caches = new Map<string, CoverCache>()

function cacheFor(directory: string): CoverCache {
  let cache = caches.get(directory)
  if (!cache) {
    cache = createCoverCache(directory)
    caches.set(directory, cache)
  }
  return cache
}

/** Cache hits are served whole; they are a few tens of kilobytes. */
function imageResponse(body: Buffer, type: string, head: boolean): Response {
  const headers = new Headers(CORS_HEADERS)
  headers.set('content-type', type)
  headers.set('content-length', String(body.byteLength))
  headers.set('cache-control', 'public, max-age=86400')
  headers.set('access-control-expose-headers', 'content-range, content-length, accept-ranges')
  return new Response(head ? null : body, { status: 200, headers })
}

/**
 * 把封面缩到不超过 px 的边长。
 *
 * 用主进程里已有的 nativeImage，不引任何新依赖：几百 KB 的封面缩一张是毫秒级。
 * 缩完统一转 JPEG——封面没有透明通道，原格式（png/webp）在小尺寸下也省不了
 * 多少，反而让渲染进程多走一种解码路径。
 *
 * 纯 Node 环境（单元测试、冒烟探针）里 require('electron') 拿不到 nativeImage，
 * 这时返回 null、原图照发：缩图是省内存的手段，不该变成图片能不能显示的条件。
 */
function shrinkImage(body: Buffer, px: number): { body: Buffer; type: string } | null {
  try {
    const { nativeImage } = require('electron') as {
      nativeImage: {
        createFromBuffer(buffer: Buffer): {
          isEmpty(): boolean
          getSize(): { width: number; height: number }
          resize(options: { width?: number; height?: number; quality?: string }): {
            toJPEG(quality: number): Buffer
          }
        }
      }
    }
    const image = nativeImage.createFromBuffer(body)
    if (image.isEmpty()) return null
    const { width, height } = image.getSize()
    if (width <= px && height <= px) return null
    // 只给长边，另一边按原比例走——封面偶尔不是正方形，拉伸比模糊更难看。
    const resized =
      width >= height
        ? image.resize({ width: px, quality: 'good' })
        : image.resize({ height: px, quality: 'good' })
    const out = resized.toJPEG(82)
    if (!out || out.byteLength === 0) return null
    return { body: out, type: 'image/jpeg' }
  } catch {
    return null
  }
}

/**
 * Covers take a different path from audio: they are small, they repeat on every
 * launch, and they never need a Range. Buffering one is cheap; buffering a track
 * would not be.
 */
async function proxyImage(
  target: string,
  request: Request,
  cacheDir: string | null,
  px: number
): Promise<Response> {
  const cache = cacheDir ? cacheFor(cacheDir) : null
  const head = request.method === 'HEAD'
  /*
   * 同一张封面会有两种尺寸在跑：列表要 96，大卡要 300。缓存 key 带上尺寸，
   * 免得 96 的那份被大卡拿去铺满 300px 的格子。
   */
  const key = px > 0 ? `n${px}|${target}` : target

  if (cache) {
    const hit = await cache.get(key)
    if (hit) return imageResponse(hit.body, hit.type, head)
  }

  await acquireImage()
  try {
    const upstream = await fetchUpstream(target, request.headers.get('range'))
    const type = (upstream.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim()

    if (!upstream.ok || !type.startsWith('image/')) {
      // 上游拒绝或给的不是图：原样透传，不写缓存。
      const headers = new Headers(CORS_HEADERS)
      for (const name of PASSTHROUGH) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
      }
      headers.set('cache-control', 'no-store')
      return new Response(upstream.body, { status: upstream.status, headers })
    }

    let body: Buffer = Buffer.from(await upstream.arrayBuffer())
    let outType = type
    if (px > 0) {
      const shrunk = shrinkImage(body, px)
      if (shrunk) {
        body = shrunk.body
        outType = shrunk.type
      }
    }
    if (cache) cache.put(key, body, outType)
    return imageResponse(body, outType, head)
  } finally {
    releaseImage()
  }
}

/**
 * One proxy request, decoupled from the scheme registration so the smoke probe
 * can drive it without an Electron runtime.
 *
 * `options.cacheDir` 有值才开封面缓存：测试与探针不传，行为与以前一致。
 */
export async function handleRemoteRequest(
  request: Request,
  options: { cacheDir?: string | null } = {}
): Promise<Response> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return new Response('bad url', { status: 400, headers: CORS_HEADERS })
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: PREFLIGHT_HEADERS })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: CORS_HEADERS })
  }

  const image = url.host === 'image'
  if (!image && url.host !== 'stream') {
    return new Response('not found', { status: 404, headers: CORS_HEADERS })
  }

  const resolved = targetOf(url)
  if (!resolved) return new Response('bad target', { status: 400, headers: CORS_HEADERS })

  let hostname: string
  try {
    hostname = new URL(resolved.target).hostname
  } catch {
    return new Response('bad target', { status: 400, headers: CORS_HEADERS })
  }
  if (!(await isAllowedHost(hostname))) {
    // Deliberately vague: the answer says "no" without describing the network
    // the caller just tried to reach.
    return new Response('forbidden', { status: 403, headers: CORS_HEADERS })
  }

  try {
    if (image) return await proxyImage(resolved.target, request, options.cacheDir ?? null, resolved.px)
    return await proxy(resolved.target, request, false)
  } catch (error) {
    // The upstream URL can carry a signed token, so only the host is logged.
    console.error('[aurora] remote stream failed', hostname, error)
    return new Response('upstream error', { status: 502, headers: CORS_HEADERS })
  }
}

/** 封面缓存放在 userData 下，跟着应用数据一起被卸载器清掉。 */
function coverCacheDirectory(): string | null {
  try {
    const { app } = require('electron') as { app: { getPath(name: string): string } }
    return path.join(app.getPath('userData'), 'cover-cache')
  } catch {
    // 拿不到目录就不缓存：缓存是加速，不是功能。
    return null
  }
}

export function handleRemoteProtocol(): void {
  const { protocol } = electronProtocol()
  const cacheDir = coverCacheDirectory()
  protocol.handle(REMOTE_SCHEME, (request) => handleRemoteRequest(request, { cacheDir }))
}
