import { createHash } from 'node:crypto'
import {
  closeSync,
  createReadStream,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  write
} from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'

/**
 * 下载一个发布附件，多线路、多连接分段、断点续传。
 *
 * 为什么不用 electron-updater 自己的下载：它只认 GitHub 的下载域名，
 * 单连接、不换线，136 MB 的包在差线路上能爬半小时；失败只会抛给调用方。
 *
 * 这里分两步。先拿几十 KB 给每条线路测速，按实测吞吐排序——凭印象排的顺序
 * 经常是反的，直连有时最快，有时一条加速源反而更慢。再按连接数把文件切段，
 * 每段一条长连接从头流到尾部，直接写到文件的对应偏移上，不需要最后拼包。
 * 段内进度落在 .part.map 里，进程被杀、线路断流都从断点接着走。
 *
 * 校验值来自 GitHub 那边的 latest.yml，不取自镜像，镜像换了包也装不上。
 */

/** 一条下载线路。`prefix` 为空表示直连。 */
export interface DownloadSource {
  name: string
  prefix: string
}

/** 本机代理；隧道走 CONNECT，和 electron-updater 那边的路由各算各的。 */
export interface ProxyEndpoint {
  host: string
  port: number
}

interface DownloadProgress {
  percent: number
  transferred: number
  total: number
}

interface DownloadOptions {
  /** 原始下载地址，各线路把它整段拼在前缀后面。 */
  url: string
  /** 存成什么文件名。 */
  fileName: string
  /** base64 的 sha512，来自 latest.yml；空串表示不校验。 */
  sha512: string
  /** 落在哪个目录。 */
  dir: string
  sources: DownloadSource[]
  /** 发布页给的大小，用来在探测之前就知道总量；拿不到就靠响应头。 */
  expectedSize?: number
  /** 并发连接数；不给就按线路实测速度定。 */
  connections?: number
  onProgress?: (progress: DownloadProgress) => void
  /** 线路选择与降级写进启动日志，出问题时能看出走的哪条线。 */
  onNote?: (note: string) => void
  connectTimeoutMs?: number
  idleTimeoutMs?: number
  /** 有可用代理时走它；测速也会带上，否则测出来的不是真实速度。 */
  proxy?: ProxyEndpoint | null
  /**
   * 测速要试的路由，`null` 表示直连。
   *
   * 代理客户端在听、却转发不出去的时候，只按 `proxy` 试会把每条线路都判死，
   * 界面停在 0% 不动——校园网里最常见的就是这一幕。把直连一起放进候选，
   * 让实测数据决定走哪条，而不是让一次失败的上游把整次下载拖死。
   */
  proxyCandidates?: Array<ProxyEndpoint | null>
}

const REDIRECT_LIMIT = 5
/** 测速取的前端字节数：够看出量级，又不至于在大文件上白等。 */
const PROBE_BYTES = 1024 * 1024
const PROBE_TIMEOUT_MS = 3000
const MAX_CONNECTIONS = 16
const MIN_SEGMENT = 512 * 1024
const MAX_SEGMENT_FAILS = 4

/** 线路把 Range 吞了，返回整包——分段这套对它不成立，得换回整包下载。 */
class NoRangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoRangeError'
  }
}

/** 一条已经测过速的线路。 */
interface Route {
  source: DownloadSource
  /** 字节/秒，探测阶段实测。 */
  bps: number
  /** 该线路认不认 Range 续传。 */
  seeks: boolean
  /** 连续失败次数，到阈值就退场。 */
  fails: number
  /** 这条线路实测时走的代理；`null` 是直连。 */
  proxy: ProxyEndpoint | null
}

/** 一条线路配上一条路由，才是测速真正要比的东西。 */
interface Attempt {
  source: DownloadSource
  proxy: ProxyEndpoint | null
}

/** 日志里怎么称呼一条路由：代理端口写出来，直连就写直连。 */
function routeName(proxy: ProxyEndpoint | null): string {
  return proxy ? '代理 ' + proxy.host + ':' + proxy.port : '直连'
}

/** 文件的一段，从头流到尾，记录已经写到哪。 */
interface Segment {
  start: number
  end: number
  /** 下一个要写的偏移；等于 start 表示这段还没开始。 */
  next: number
  fails: number
}

interface PartState {
  total: number
  segments: Array<{ start: number; end: number; next: number }>
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function openTunnel(proxy: ProxyEndpoint, host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: proxy.host, port: proxy.port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('代理连接超时'))
    }, timeoutMs)
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    socket.once('connect', () => {
      socket.write('CONNECT ' + host + ':' + port + ' HTTP/1.1\r\nHost: ' + host + ':' + port + '\r\n\r\n')
      let seen = Buffer.alloc(0)
      const onData = (chunk: Buffer): void => {
        seen = Buffer.concat([seen, chunk])
        const split = seen.indexOf('\r\n\r\n')
        if (split < 0) {
          if (seen.length > 16384) {
            socket.destroy()
            clearTimeout(timer)
            reject(new Error('代理响应异常'))
          }
          return
        }
        socket.removeListener('data', onData)
        clearTimeout(timer)
        const line = seen.subarray(0, split).toString('latin1')
        const status = Number((/^HTTP\/1\.[01] (\d{3})/.exec(line) ?? [])[1] ?? 0)
        if (status !== 200) {
          socket.destroy()
          reject(new Error('代理拒绝 ' + status))
          return
        }
        resolve(socket)
      }
      socket.on('data', onData)
    })
  })
}

/** 建一条到目标地址的请求；有代理时先打隧道。 */
async function openRequest(
  target: string,
  headers: Record<string, string>,
  options: { proxy?: ProxyEndpoint | null; connectTimeoutMs: number },
  hops = 0
): Promise<http.IncomingMessage> {
  if (hops > REDIRECT_LIMIT) throw new Error('重定向过多')
  const parsed = new URL(target)
  const secure = parsed.protocol === 'https:'
  const port = Number(parsed.port || (secure ? 443 : 80))
  const outgoing: Record<string, string> = {
    'user-agent': 'Aurora updater',
    accept: 'application/octet-stream',
    ...headers,
    host: parsed.host
  }

  let response: http.IncomingMessage
  if (options.proxy) {
    const tunnel = await openTunnel(options.proxy, parsed.hostname, port, options.connectTimeoutMs)
    const socket = secure ? tls.connect({ socket: tunnel, servername: parsed.hostname }) : tunnel
    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        socket.removeListener('error', onError)
        resolve()
      }
      const onError = (error: Error): void => {
        socket.removeListener('secureConnect', onReady)
        reject(error)
      }
      if (secure) socket.once('secureConnect', onReady)
      else queueMicrotask(onReady)
      socket.once('error', onError)
    })
    response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = https.request(
        {
          host: parsed.hostname,
          port,
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: outgoing,
          agent: false,
          createConnection: () => socket
        } as https.RequestOptions,
        resolve
      )
      const timer = setTimeout(() => request.destroy(new Error('连接超时')), options.connectTimeoutMs)
      request.on('response', () => clearTimeout(timer))
      request.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      request.end()
    })
  } else {
    const client = secure ? https : http
    response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = client.get(target, { headers: outgoing }, resolve)
      // `setTimeout` 只在 socket 建好之后才武装；DNS 或握手卡住时它一声不响。
      const timer = setTimeout(() => request.destroy(new Error('连接超时')), options.connectTimeoutMs)
      request.on('response', () => clearTimeout(timer))
      request.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  const status = response.statusCode ?? 0
  if (status >= 300 && status < 400 && response.headers.location) {
    const next = new URL(response.headers.location, target).toString()
    response.resume()
    return openRequest(next, headers, options, hops + 1)
  }
  return response
}

/** `content-range` 里的总长度，没有就给 0。 */
function totalOf(response: http.IncomingMessage): number {
  const range = response.headers['content-range']
  if (typeof range === 'string') {
    const match = /\/(\d+)\s*$/.exec(range)
    if (match) return Number(match[1])
  }
  const length = Number(response.headers['content-length'] ?? 0)
  return Number.isFinite(length) && length > 0 ? length : 0
}

/**
 * 给一条线路测速。
 *
 * 只判两件事：能不能拿到数据、拿得有多快。测不出量级的线路直接排到最后，
 * 而不是让它先占着下载队列等超时——用户看到的「卡住」多半就是这么来的。
 */
async function probe(
  source: DownloadSource,
  options: DownloadOptions,
  deadline: number,
  proxy: ProxyEndpoint | null
): Promise<Route | null> {
  const started = Date.now()
  try {
    const response = await openRequest(
      source.prefix + options.url,
      { range: 'bytes=0-' + (PROBE_BYTES - 1) },
      { proxy, connectTimeoutMs: Math.min(PROBE_TIMEOUT_MS, options.connectTimeoutMs ?? PROBE_TIMEOUT_MS) }
    )
    const status = response.statusCode ?? 0
    if (status !== 200 && status !== 206) {
      response.resume()
      return null
    }
    const seeks = status === 206
    let got = 0
    await new Promise<void>((resolve) => {
      const stop = (): void => {
        clearTimeout(timer)
        response.destroy()
        resolve()
      }
      const timer = setTimeout(stop, Math.max(700, deadline - (Date.now() - started)))
      response.on('data', (chunk: Buffer) => {
        got += chunk.length
        if (got >= PROBE_BYTES) stop()
      })
      response.on('end', () => {
        clearTimeout(timer)
        resolve()
      })
      response.on('error', stop)
    })
    const seconds = (Date.now() - started) / 1000
    if (got < 16 * 1024) return null
    return { source, bps: got / seconds, seeks, fails: 0, proxy }
  } catch {
    return null
  }
}

/** 并发测速，按吞吐从快到慢排；全挂时退回给定的顺序。 */
async function rankRoutes(options: DownloadOptions): Promise<Route[]> {
  const deadline = PROBE_TIMEOUT_MS
  const proxies = options.proxyCandidates?.length
    ? options.proxyCandidates
    : [options.proxy ?? null]
  const attempts: Attempt[] = []
  for (const source of options.sources) {
    for (const proxy of proxies) attempts.push({ source, proxy })
  }
  const routes = await Promise.all(
    attempts.map((attempt) => probe(attempt.source, options, deadline, attempt.proxy))
  )
  const alive = routes.filter((route): route is Route => route !== null)
  const note = (text: string): void => options.onNote?.(text)
  if (alive.length === 0) {
    note('测速全部失败，按给定顺序直接下')
    return attempts.map((attempt) => ({ ...attempt, bps: 0, seeks: true, fails: 0 }))
  }
  alive.sort((a, b) => b.bps - a.bps)
  note(
    '线路实测：' +
      alive
        .map(
          (route) =>
            route.source.name + '（' + routeName(route.proxy) + '） ' +
            (route.bps / 1048576).toFixed(2) + ' MB/s'
        )
        .join('、')
  )
  // 一条都不认 Range 的话分段的假设就不成立了，交给整包路径。
  if (!alive.some((route) => route.seeks)) return alive
  return alive
}

/** 把文件切成若干段；太小就少切几段，免得每段只剩几十 KB。 */
function splitSegments(total: number, connections: number): Segment[] {
  const wanted = clamp(connections, 1, MAX_CONNECTIONS)
  const count = Math.max(1, Math.min(wanted, Math.floor(total / MIN_SEGMENT) || 1))
  const size = Math.ceil(total / count)
  const segments: Segment[] = []
  for (let at = 0; at < total; at += size) {
    segments.push({ start: at, end: Math.min(at + size, total) - 1, next: at, fails: 0 })
  }
  return segments
}

function readState(file: string): PartState | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as PartState
    if (!Number.isFinite(parsed.total) || !Array.isArray(parsed.segments)) return null
    return parsed
  } catch {
    return null
  }
}

function writeState(file: string, total: number, segments: Segment[]): void {
  try {
    const state: PartState = {
      total,
      segments: segments.map((segment) => ({ start: segment.start, end: segment.end, next: segment.next }))
    }
    writeFileSync(file, JSON.stringify(state), 'utf8')
  } catch {
    // 状态文件写不下去只是丢了断点，不该让下载失败
  }
}

/** 按偏移写，写完才 resolve；部分写要补齐，否则文件里会留洞。 */
function writeAt(handle: number, buffer: Buffer, position: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let offset = 0
    const step = (): void => {
      write(handle, buffer, offset, buffer.length - offset, position + offset, (error, written) => {
        if (error) {
          reject(error)
          return
        }
        offset += written
        if (offset < buffer.length) step()
        else resolve()
      })
    }
    step()
  })
}

/** 线路池：按实测速度挑，连续失败就退场。 */
class RoutePool {
  private readonly routes: Route[]

  private cursor = 0

  constructor(routes: Route[]) {
    this.routes = routes
  }

  pick(): Route | null {
    const usable = this.routes.filter((route) => route.fails < MAX_SEGMENT_FAILS)
    if (usable.length === 0) return null
    const route = usable[this.cursor % usable.length]
    this.cursor += 1
    return route ?? null
  }

  best(): Route | null {
    return this.routes.find((route) => route.fails < MAX_SEGMENT_FAILS) ?? null
  }
}

/** 一段一条长连接，流式写到固定偏移；断了从 `next` 接着来。 */
async function streamSegment(
  route: Route,
  segment: Segment,
  handle: number,
  total: number,
  options: DownloadOptions,
  tick: () => void
): Promise<void> {
  const from = segment.next
  const response = await openRequest(
    route.source.prefix + options.url,
    { range: 'bytes=' + from + '-' + segment.end },
    { proxy: route.proxy, connectTimeoutMs: options.connectTimeoutMs ?? 15000 }
  )
  const status = response.statusCode ?? 0
  if (status !== 200 && status !== 206) {
    response.resume()
    throw new Error(route.source.name + ' HTTP ' + status)
  }
  // 200 表示对方把 Range 吞了，从头给整包。段不是从 0 开始的话没法接。
  if (status === 200 && from !== 0) {
    response.resume()
    route.seeks = false
    throw new NoRangeError(route.source.name + ' 不支持续传')
  }
  const sawTotal = totalOf(response)
  if (sawTotal > 0 && sawTotal !== total) {
    response.resume()
    throw new Error(route.source.name + ' 文件大小对不上')
  }

  const idle = options.idleTimeoutMs ?? 30000
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let idleTimer: NodeJS.Timeout | undefined
    let startTimer: NodeJS.Timeout | undefined
    const pending: Array<Promise<void>> = []
    const clear = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      if (startTimer) clearTimeout(startTimer)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clear()
      response.destroy()
      reject(error)
    }
    // 每来一块就重新计时：静默连接要收摊，正在走的连接不能被误杀。
    const arm = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => fail(new Error(route.source.name + ' 下载卡住')), idle)
    }
    arm()
    response.on('data', (chunk: Buffer) => {
      arm()
      const remaining = segment.end - segment.next + 1
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
      pending.push(writeAt(handle, slice, segment.next))
      segment.next += slice.length
      tick()
    })
    response.on('end', () => {
      clear()
      Promise.all(pending).then(() => {
        if (settled) return
        if (segment.next !== segment.end + 1) {
          settled = true
          reject(new Error(route.source.name + ' 只下到 ' + segment.next + '/' + (segment.end + 1)))
          return
        }
        settled = true
        resolve()
      }, (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      })
    })
    response.on('error', (error) => {
      clear()
      fail(error)
    })
    // 建连之后一块都没来，说明这条线路不给数据，别一直占着这段。
    startTimer = setTimeout(() => {
      if (!settled && segment.next === from) fail(new Error(route.source.name + ' 没有数据'))
    }, options.connectTimeoutMs ?? 15000)
  })
}

async function digestOf(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk as Buffer))
    stream.on('end', () => resolve(hash.digest('base64')))
    stream.on('error', reject)
  })
}

async function verify(file: string, expected: string): Promise<void> {
  if (!expected) return
  const actual = await digestOf(file)
  if (actual !== expected) {
    rmSync(file, { force: true })
    throw new Error('校验不通过')
  }
}

/** 所有线路都不认 Range 时的退路：单连接整包，仍旧带断点。 */
async function downloadWhole(
  route: Route,
  options: DownloadOptions,
  part: string
): Promise<void> {
  const known = existsSync(part) ? statSync(part).size : 0
  const response = await openRequest(
    route.source.prefix + options.url,
    known > 0 ? { range: 'bytes=' + known + '-' } : {},
    { proxy: route.proxy, connectTimeoutMs: options.connectTimeoutMs ?? 15000 }
  )
  const status = response.statusCode ?? 0
  const resuming = status === 206 && known > 0
  if (status !== 200 && status !== 206) {
    response.resume()
    throw new Error(route.source.name + ' HTTP ' + status)
  }
  const total = totalOf(response)
  const start = resuming ? known : 0
  const out = openSync(part, resuming ? 'a' : 'w')
  let received = 0
  let writeError: Error | null = null
  const pending: Array<Promise<void>> = []
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        response.destroy()
        reject(error)
      }
      response.setTimeout(options.idleTimeoutMs ?? 30000, () => fail(new Error('下载卡住')))
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        // 异步写先记账，等 `end` 之后统一等它们落盘；否则 close 抢在前面，
        // 文件会停在最后一次写完成的位置，校验就报「不完整」。
        const task = writeAt(out, chunk, start + received - chunk.length)
        pending.push(task)
        task.catch((error: Error) => {
          if (!writeError) writeError = error
        })
        options.onProgress?.({
          percent: total > 0 ? Math.min(100, ((start + received) / total) * 100) : 0,
          transferred: start + received,
          total: total > 0 ? total : start + received
        })
      })
      response.on('end', () => {
        if (settled) return
        settled = true
        resolve()
      })
      response.on('error', fail)
    })
  } finally {
    await Promise.allSettled(pending)
    closeSync(out)
  }
  const writeFailure = writeError as unknown as Error | null
  if (writeFailure) throw writeFailure
  const size = statSync(part).size
  if (total > 0 && size !== total) throw new Error('下载不完整 ' + size + '/' + total)
}

/**
 * 按线路池把文件下完。
 *
 * 每段一条连接，写的是同一个文件的固定偏移，所以中途换线路、换段序都不会
 * 破坏已经落盘的部分；状态文件让下一次启动接着下，而不是把 120 MB 重来。
 */
async function downloadSegmented(
  routes: Route[],
  options: DownloadOptions,
  part: string,
  stateFile: string,
  total: number
): Promise<void> {
  const remembered = readState(stateFile)
  const resumable = remembered !== null && remembered.total === total
  const segments: Segment[] = resumable
    ? remembered.segments.map((segment) => ({ ...segment, fails: 0 }))
    : splitSegments(total, options.connections ?? autoConnections(routes))
  const note = (text: string): void => options.onNote?.(text)
  if (resumable) {
    const done = segments.reduce((sum, segment) => sum + (segment.next - segment.start), 0)
    if (done > 0) note('断点续传：已有 ' + (done / 1048576).toFixed(1) + ' MB')
  } else {
    writeFileSync(part, '')
    const handle = openSync(part, 'r+')
    ftruncateSync(handle, total)
    closeSync(handle)
  }

  const pool = new RoutePool(routes)
  const handle = openSync(part, 'r+')
  let reported = 0
  const report = (): void => {
    const done = segments.reduce((sum, segment) => sum + (segment.next - segment.start), 0)
    const now = Date.now()
    if (now - reported < 180 && done < total) return
    reported = now
    options.onProgress?.({ percent: Math.min(100, (done / Math.max(1, total)) * 100), transferred: done, total })
  }

  try {
    await Promise.all(
      segments.map(async (segment) => {
        while (segment.next <= segment.end) {
          const route = pool.pick()
          if (!route) throw new Error('所有下载线路都失败了')
          try {
            await streamSegment(route, segment, handle, total, options, report)
            writeState(stateFile, total, segments)
            break
          } catch (error) {
            if (error instanceof NoRangeError) {
              // 这条线路不给 Range，别再让它接别的段；还有线路就换一条。
              route.fails = MAX_SEGMENT_FAILS
              if (!pool.best()) throw error
              note(error.message + '，换下一条线路')
              continue
            }
            segment.fails += 1
            route.fails += 1
            writeState(stateFile, total, segments)
            const message = error instanceof Error ? error.message : String(error)
            note('线路 ' + route.source.name + ' 这段失败：' + message + '（已下 ' + (segment.next - segment.start) + ' 字节）')
            if (segment.fails >= MAX_SEGMENT_FAILS) throw new Error(message)
            report()
          }
        }
        writeState(stateFile, total, segments)
        report()
      })
    )
  } finally {
    closeSync(handle)
  }
  options.onProgress?.({ percent: 100, transferred: total, total })
}

/** 慢线路多开几条，快线路不必太多；连接数不是越多越好。 */
function autoConnections(routes: Route[]): number {
  const best = routes[0]?.bps ?? 0
  if (best >= 8 * 1048576) return 6
  if (best >= 3 * 1048576) return 8
  if (best >= 1 * 1048576) return 12
  return 8
}

/**
 * 把这个版本的安装包取回来，校验通过才算数。
 *
 * 失败时保留 `.part` 与状态文件：下一次点击从断点继续，而不是把已经下过的
 * 一百多兆扔掉重来。
 */
export async function downloadReleaseFile(options: DownloadOptions): Promise<string> {
  mkdirSync(options.dir, { recursive: true })
  const fileName = path.basename(options.fileName)
  const target = path.join(options.dir, fileName)
  const part = target + '.part'
  const stateFile = part + '.map'

  const routes = await rankRoutes(options)
  const usable = routes.filter((route) => route.seeks)
  const note = (text: string): void => options.onNote?.(text)

  if (usable.length > 0) {
    const remembered = readState(stateFile)
    const total = remembered?.total ?? options.expectedSize ?? (await sizeOf(routes, options))
    if (total > 0) {
      let fallback = false
      try {
        await downloadSegmented(routes, options, part, stateFile, total)
      } catch (error) {
        if (error instanceof NoRangeError) {
          // 所有线路都不认 Range，分段写下的半截文件没有续传价值，清掉重来。
          fallback = true
          rmSync(part, { force: true })
          rmSync(stateFile, { force: true })
          note('没有线路支持续传，改用整包下载')
        } else {
          /*
           * 分段失败就停在这里，把 .part 和状态文件原样留着。
           * 掉到整包路径会 openSync(part, 'w') 把文件截成 0——已经落盘的几十兆
           * 当场作废，而状态文件还记着旧进度，下次续传就写进一个空洞里。
           */
          rmSync(target, { force: true })
          throw new Error('更新包下载失败：' + (error instanceof Error ? error.message : String(error)))
        }
      }
      if (!fallback) {
        try {
          await verify(part, options.sha512)
        } catch (error) {
          // 内容坏了，续传没有意义，连进度一起清掉。
          rmSync(stateFile, { force: true })
          throw new Error('更新包下载失败：' + (error instanceof Error ? error.message : String(error)))
        }
        rmSync(target, { force: true })
        renameSync(part, target)
        rmSync(stateFile, { force: true })
        return target
      }
    }
    note('拿不到安装包大小，改用整包下载')
  }

  // 没有任何线路认 Range（或者拿不到大小）才走这里：单连接整包，带文件名续传。
  rmSync(stateFile, { force: true })
  const failures: string[] = []
  for (const route of routes) {
    try {
      await downloadWhole(route, options, part)
      await verify(part, options.sha512)
      rmSync(target, { force: true })
      renameSync(part, target)
      return target
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(route.source.name + ' ' + message)
      if (message === '校验不通过') break
    }
  }
  throw new Error('更新包下载失败：' + failures.slice(-4).join('；'))
}

/** 问一条线路要总长度：发一个 1 字节的 Range，读 Content-Range。 */
async function sizeOf(routes: Route[], options: DownloadOptions): Promise<number> {
  for (const route of routes) {
    try {
      const response = await openRequest(
        route.source.prefix + options.url,
        { range: 'bytes=0-0' },
        { proxy: route.proxy, connectTimeoutMs: options.connectTimeoutMs ?? 15000 }
      )
      response.resume()
      const total = totalOf(response)
      if (total > 0) return total
    } catch {
      // 换下一条问
    }
  }
  return 0
}

/**
 * 从任意一条线路取一段小文本（latest.yml 这类清单）。
 *
 * 清单只有几百字节，但它的正常地址在 github.com 上，会 302 到
 * release-assets.githubusercontent.com——校园网里那个域名直接不通，而
 * github.com 本身通。所以清单也要走镜像前缀，不能交给 electron-updater。
 */
export async function fetchReleaseText(request: {
  url: string
  sources: DownloadSource[]
  proxy?: ProxyEndpoint | null
  /** 要试的路由，`null` 是直连；省略时只看 `proxy`。 */
  proxies?: Array<ProxyEndpoint | null>
  timeoutMs?: number
  maxBytes?: number
}): Promise<string> {
  const limit = request.maxBytes ?? 64 * 1024
  const timeout = request.timeoutMs ?? 8000
  const proxies = request.proxies?.length ? request.proxies : [request.proxy ?? null]

  // 并发问每一条线路 × 每一条路由，谁先给出非空内容就用谁。
  // 串行试的代价在这里特别明显：第一条是直连，校园网里它要等满超时才轮到镜像，
  // 而这份清单只有几百字节，本该是点下去就有的事。
  const attempts = proxies.flatMap((proxy) =>
    request.sources.map(async (source) => {
      const label = source.name + '（' + routeName(proxy) + '）'
      const response = await openRequest(
        source.prefix + request.url,
        {},
        { proxy, connectTimeoutMs: timeout }
      )
      const status = response.statusCode ?? 0
      if (status !== 200) {
        response.resume()
        throw new Error(label + ' HTTP ' + status)
      }
      const text = await new Promise<string>((resolve, reject) => {
        const parts: Buffer[] = []
        let size = 0
        const timer = setTimeout(() => {
          response.destroy()
          reject(new Error(label + ' 读取超时'))
        }, timeout)
        response.on('data', (chunk: Buffer) => {
          parts.push(chunk)
          size += chunk.length
          if (size > limit) {
            clearTimeout(timer)
            response.destroy()
            reject(new Error(label + ' 清单过大'))
          }
        })
        response.on('end', () => {
          clearTimeout(timer)
          resolve(Buffer.concat(parts).toString('utf8'))
        })
        response.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })
      if (text.trim().length === 0) throw new Error(label + ' 空内容')
      return text
    })
  )

  try {
    return await Promise.any(attempts)
  } catch {
    throw new Error('取不到更新清单：' + request.sources.map((source) => source.name).join('、') + ' 都不通')
  }
}

