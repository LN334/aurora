import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

/**
 * 下载一个发布附件，带多线路与断点续传。
 *
 * 为什么不用 electron-updater 自己的下载：它只认 GitHub 的下载域名，
 * objects.githubusercontent.com 在国内经常整段 RST，136 MB 的文件一次也下不来；
 * 而它的失败只会抛给调用方，没有「换一条路再试」的余地。
 *
 * 这里的线路是「前缀 + 原始 URL」：直连就是空前缀，加速源就是一个反代前缀。
 * 校验值来自 GitHub 那边拿到的 latest.yml，不取自镜像，所以镜像换了包也装不上。
 */

/** 一条下载线路。`prefix` 为空表示直连。 */
export interface DownloadSource {
  name: string
  prefix: string
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
  onProgress?: (progress: DownloadProgress) => void
  /** 每条线路最多试几次（默认 1）：线路够多，重试同一源不如换一条。 */
  attemptsPerSource?: number
  connectTimeoutMs?: number
  idleTimeoutMs?: number
}

const REDIRECT_LIMIT = 5

function request(url: string, start: number, connectTimeoutMs: number, hops = 0): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (hops > REDIRECT_LIMIT) {
      reject(new Error('重定向过多'))
      return
    }
    const client = url.startsWith('https:') ? https : http
    const headers: Record<string, string> = {
      'user-agent': 'Aurora updater',
      accept: 'application/octet-stream'
    }
    if (start > 0) headers.range = 'bytes=' + start + '-'
    // `req.setTimeout` only arms once the socket exists; a DNS or connect stall
    // would sit there far past the deadline. This timer covers the whole wait.
    const timer = setTimeout(() => req.destroy(new Error('连接超时')), connectTimeoutMs)
    const req = client.get(url, { headers }, (response) => {
      clearTimeout(timer)
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        const next = new URL(response.headers.location, url).toString()
        response.resume()
        resolve(request(next, start, connectTimeoutMs, hops + 1))
        return
      }
      resolve(response)
    })
    req.setTimeout(connectTimeoutMs, () => req.destroy(new Error('连接超时')))
    req.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

function totalOf(response: http.IncomingMessage, start: number): number {
  const range = response.headers['content-range']
  if (typeof range === 'string') {
    const match = /\/(\d+)$/.exec(range)
    if (match) return Number(match[1])
  }
  const length = Number(response.headers['content-length'] ?? 0)
  return length > 0 ? start + length : 0
}

async function fetchInto(source: DownloadSource, options: DownloadOptions, part: string): Promise<void> {
  const known = existsSync(part) ? statSync(part).size : 0
  const response = await request(source.prefix + options.url, known, options.connectTimeoutMs ?? 15000)
  const status = response.statusCode ?? 0
  if (status === 416) {
    response.resume()
    rmSync(part, { force: true })
    throw new Error('续传位置无效')
  }
  if (status !== 200 && status !== 206) {
    response.resume()
    throw new Error('HTTP ' + status)
  }
  const resuming = status === 206 && known > 0
  if (!resuming && known > 0) rmSync(part, { force: true })
  const start = resuming ? known : 0
  const total = totalOf(response, start)
  const out = createWriteStream(part, { flags: resuming ? 'a' : 'w' })
  let received = 0
  let lastEmit = 0

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      response.destroy()
      out.destroy()
      reject(error)
    }
    response.setTimeout(options.idleTimeoutMs ?? 30000, () => fail(new Error('下载卡住')))
    response.on('data', (chunk: Buffer) => {
      received += chunk.length
      const transferred = start + received
      const now = Date.now()
      if (now - lastEmit > 200) {
        lastEmit = now
        options.onProgress?.({
          percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
          transferred,
          total
        })
      }
      if (!out.write(chunk)) response.pause()
    })
    out.on('drain', () => response.resume())
    response.on('end', () => {
      out.end(() => {
        if (settled) return
        settled = true
        resolve()
      })
    })
    response.on('error', fail)
    out.on('error', fail)
  })

  const size = statSync(part).size
  if (total > 0 && size !== total) throw new Error('下载不完整 ' + size + '/' + total)
  options.onProgress?.({ percent: 100, transferred: size, total: size })
}

function digestOf(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
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

/**
 * 按顺序试每一条线路，直到拿到校验通过的文件。
 *
 * 失败时保留 `.part`，下一条线路从断点继续——国内的反代经常在几十兆处断流，
 * 没有续传就永远下不完。校验失败则删掉文件，换一条线路从头来。
 */
export async function downloadReleaseFile(options: DownloadOptions): Promise<string> {
  mkdirSync(options.dir, { recursive: true })
  const fileName = path.basename(options.fileName)
  const target = path.join(options.dir, fileName)
  const part = target + '.part'
  const attempts = options.attemptsPerSource ?? 1
  const failures: string[] = []

  for (const source of options.sources) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await fetchInto(source, options, part)
        await verify(part, options.sha512)
        rmSync(target, { force: true })
        renameSync(part, target)
        return target
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(source.name + '#' + attempt + ' ' + message)
        if (message === '校验不通过') break
      }
    }
  }

  throw new Error('更新包下载失败：' + failures.slice(-4).join('；'))
}
