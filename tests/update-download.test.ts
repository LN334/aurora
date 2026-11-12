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

test('已经有半截文件时从断点继续，而不是从头再下', async () => {
  const dir = makeDir()
  writeFileSync(path.join(dir, 'fixture.bin.part'), PAYLOAD.subarray(0, 1000))
  fixture.ranges.length = 0
  const file = await downloadReleaseFile({
    url: 'fixture.bin',
    fileName: 'fixture.bin',
    sha512: SHA,
    dir,
    sources: [{ name: 'good', prefix: fixture.origin + '/good/' }]
  })
  assert.equal(fixture.ranges[0], 'bytes=1000-')
  assert.equal(readFileSync(file).equals(PAYLOAD), true)
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
