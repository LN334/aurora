import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { downloadReleaseFile, type DownloadSource } from '../electron/update-download.ts'

const PAYLOAD = Buffer.alloc(200_000)
for (let at = 0; at < PAYLOAD.length; at += 1) PAYLOAD[at] = (at * 31) % 251
const SHA = createHash('sha512').update(PAYLOAD).digest('base64')

interface Fixture {
  origin: string
  ranges: string[]
  close(): Promise<void>
}

async function startFixture(): Promise<Fixture> {
  const ranges: string[] = []
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith('/cut/')) {
      // 发一小段就断：多段并发下每段都留半截，用来验证状态文件能不能接着走。
      const range = req.headers.range
      const match = typeof range === 'string' ? /bytes=(\d+)-(\d+)/.exec(range) : null
      const start = match ? Number(match[1]) : 0
      const end = match ? Number(match[2]) : PAYLOAD.length - 1
      res.statusCode = 206
      res.setHeader('content-range', 'bytes ' + start + '-' + end + '/' + PAYLOAD.length)
      res.setHeader('content-length', String(end - start + 1))
      res.write(PAYLOAD.subarray(start, Math.min(start + 40000, end + 1)))
      setTimeout(() => res.destroy(), 5)
      return
    }
    if (url.startsWith('/bad/')) {
      res.statusCode = 500
      res.end('no')
      return
    }
    if (url.startsWith('/tamper/')) {
      const copy = Buffer.from(PAYLOAD)
      copy[0] = copy[0] ^ 0xff
      res.setHeader('content-length', copy.length)
      res.end(copy)
      return
    }
    if (url.startsWith('/norange/')) {
      res.setHeader('content-length', PAYLOAD.length)
      res.end(PAYLOAD)
      return
    }
    const range = req.headers.range
    if (typeof range === 'string') {
      ranges.push(range)
      const match = /bytes=(\d+)-/.exec(range)
      const start = match ? Number(match[1]) : 0
      const slice = PAYLOAD.subarray(start)
      res.statusCode = 206
      res.setHeader('content-length', slice.length)
      res.setHeader('content-range', 'bytes ' + start + '-' + (PAYLOAD.length - 1) + '/' + PAYLOAD.length)
      res.end(slice)
      return
    }
    res.setHeader('content-length', PAYLOAD.length)
    res.end(PAYLOAD)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('server did not bind')
  return {
    origin: 'http://127.0.0.1:' + address.port,
    ranges,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

const fixture = await startFixture()
test.after(() => fixture.close())

function makeDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'aurora-dl-'))
}

test('一条线路挂掉时换下一条，下回来的内容和校验都对得上', async () => {
  const dir = makeDir()
  const sources: DownloadSource[] = [
    { name: 'bad', prefix: fixture.origin + '/bad/' },
    { name: 'good', prefix: fixture.origin + '/good/' }
  ]
  const file = await downloadReleaseFile({
    url: 'fixture.bin',
    fileName: 'fixture.bin',
    sha512: SHA,
    dir,
    sources
  })
  assert.equal(readFileSync(file).equals(PAYLOAD), true)
  assert.equal(existsSync(file + '.part'), false)
  rmSync(dir, { recursive: true, force: true })
})

test('中途断流后靠状态文件接着下，不把已经落盘的字节扔掉', async () => {
  const dir = makeDir()
  await assert.rejects(
    () =>
      downloadReleaseFile({
        url: 'fixture.bin',
        fileName: 'fixture.bin',
        sha512: SHA,
        dir,
        expectedSize: PAYLOAD.length,
        connections: 4,
        sources: [{ name: 'cut', prefix: fixture.origin + '/cut/' }]
      }),
    /更新包下载失败/
  )

  const stateFile = path.join(dir, 'fixture.bin.part.map')
  assert.equal(existsSync(stateFile), true, '断流后要留下状态文件')
  const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
    total: number
    segments: Array<{ start: number; end: number; next: number }>
  }
  const resumed = state.segments.reduce((sum, segment) => sum + (segment.next - segment.start), 0)
  assert.ok(resumed > 0, '断流前落盘的字节要记在状态里')

  fixture.ranges.length = 0
  const file = await downloadReleaseFile({
    url: 'fixture.bin',
    fileName: 'fixture.bin',
    sha512: SHA,
    dir,
    expectedSize: PAYLOAD.length,
    connections: 4,
    sources: [{ name: 'good', prefix: fixture.origin + '/good/' }]
  })
  assert.equal(readFileSync(file).equals(PAYLOAD), true)
  assert.ok(
    fixture.ranges.some((range) => !range.startsWith('bytes=0-')),
    '续传要从断点开始，不能整包重来'
  )
  assert.equal(existsSync(stateFile), false, '下完要把状态文件清掉')
  rmSync(dir, { recursive: true, force: true })
})

test('多段并发下每段各写各的偏移，拼出来是完整文件', async () => {
  const dir = makeDir()
  fixture.ranges.length = 0
  const file = await downloadReleaseFile({
    url: 'fixture.bin',
    fileName: 'fixture.bin',
    sha512: SHA,
    dir,
    expectedSize: PAYLOAD.length,
    connections: 4,
    sources: [{ name: 'good', prefix: fixture.origin + '/good/' }]
  })
  assert.equal(readFileSync(file).equals(PAYLOAD), true)
  const starts = fixture.ranges
    .filter((range) => /^bytes=\d+-\d+$/.test(range))
    .map((range) => Number(/bytes=(\d+)-/.exec(range)?.[1] ?? -1))
    .filter((start) => start >= 0)
  assert.ok(starts.length >= 2, '应该切成多段，而不是一条连接下到底')
  rmSync(dir, { recursive: true, force: true })
})

test('服务器不认 Range 时退回整包下载', async () => {
  const dir = makeDir()
  writeFileSync(path.join(dir, 'fixture.bin.part'), PAYLOAD.subarray(0, 1000))
  const file = await downloadReleaseFile({
    url: 'fixture.bin',
    fileName: 'fixture.bin',
    sha512: SHA,
    dir,
    sources: [{ name: 'norange', prefix: fixture.origin + '/norange/' }]
  })
  assert.equal(readFileSync(file).equals(PAYLOAD), true)
  rmSync(dir, { recursive: true, force: true })
})

test('校验不通过就删掉文件并报错，不把坏包交出去', async () => {
  const dir = makeDir()
  await assert.rejects(
    () =>
      downloadReleaseFile({
        url: 'fixture.bin',
        fileName: 'fixture.bin',
        sha512: 'not-the-right-digest',
        dir,
        sources: [{ name: 'tamper', prefix: fixture.origin + '/tamper/' }]
      }),
    /更新包下载失败/
  )
  assert.equal(existsSync(path.join(dir, 'fixture.bin')), false)
  assert.equal(existsSync(path.join(dir, 'fixture.bin.part')), false)
  rmSync(dir, { recursive: true, force: true })
})

test('代理转发不出去时，候选里的直连照样把包下完', async () => {
  const dir = makeDir()
  /*
   * 代理客户端在听、上游断了：端口连得上但隧道走不通。
   * 只给代理时每条线路都判死，界面停在 0%；给了直连候选就该自己绕过去。
   */
  const deadProxy = { host: '127.0.0.1', port: 1 }
  const file = await downloadReleaseFile({
    url: 'fixture.bin',
    fileName: 'fixture.bin',
    sha512: SHA,
    dir,
    sources: [{ name: 'good', prefix: fixture.origin + '/good/' }],
    proxy: deadProxy,
    proxyCandidates: [deadProxy, null]
  })
  assert.equal(readFileSync(file).equals(PAYLOAD), true)
  assert.equal(existsSync(file + '.part'), false)
  rmSync(dir, { recursive: true, force: true })
})
