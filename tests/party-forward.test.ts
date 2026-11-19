import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { partyState, registerStream, startHost, stopParty } from '../electron/party/room.ts'

/*
 * 音频转发：房主在自己机器上代拉，客人从房间端口取。
 *
 * 这是「哪怕他没有权限也能听到」的最后一段——有些平台的直链认 IP，客人拿了
 * 就是 403。转发之后平台看到的是房主的请求，客人只面对我们这条地址。
 */

function waitFor(check: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      if (check()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

function roomPort(): number {
  const address = partyState().address
  return Number(address.slice(address.lastIndexOf(':') + 1))
}

test('a registered stream comes back byte for byte', async () => {
  let seenUserAgent = ''
  const upstream = createServer((request, response) => {
    seenUserAgent = String(request.headers['user-agent'] ?? '')
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '5' })
    response.end('AUDIO')
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = (upstream.address() as { port: number }).port

  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const token = registerStream('netease:1', 'http://127.0.0.1:' + upstreamPort + '/a.mp3')
    assert.match(token, /^[0-9a-f]{16}$/, 'the url carries a random token, never the song id')

    const response = await fetch('http://127.0.0.1:' + roomPort() + '/stream/' + token)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'audio/mpeg')
    assert.equal(await response.text(), 'AUDIO')
    /*
     * 平台按 UA（以及部分平台的来源站）防盗链。转发时不带这些头，平台回 403，
     * 客人听到的是错误——所以这条必须钉住。
     */
    assert.match(seenUserAgent, /Chrome\/120/)
  } finally {
    stopParty()
    upstream.close()
  }
})

test('the song id alone is not a forwarding address', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    registerStream('netease:7', 'http://127.0.0.1:1/x.mp3')
    /*
     * 关键是这条：照 `netease:7` 拼地址必须拿不到东西。地址里只有随机令牌，
     * 房间码挡的是进房，挡不住有人照着规律拼 /stream/。
     */
    const response = await fetch('http://127.0.0.1:' + roomPort() + '/stream/' + encodeURIComponent('netease:7'))
    assert.equal(response.status, 404)
  } finally {
    stopParty()
  }
})

test('an unregistered token is a 404, not a hang', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const response = await fetch('http://127.0.0.1:' + roomPort() + '/stream/does-not-exist')
    assert.equal(response.status, 404)
  } finally {
    stopParty()
  }
})

test('the same track keeps one token, and old tracks get evicted', async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '1' })
    response.end('x')
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = (upstream.address() as { port: number }).port

  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const first = registerStream('netease:1', 'http://127.0.0.1:' + upstreamPort + '/a.mp3')
    const again = registerStream('netease:1', 'http://127.0.0.1:' + upstreamPort + '/a.mp3')
    assert.equal(again, first, 'the same song reuses its token')

    // 21 首之后最早那条要被挤掉：转发地址不能无限留。
    for (let index = 0; index < 20; index += 1) {
      registerStream('netease:extra-' + index, 'http://127.0.0.1:' + upstreamPort + '/b.mp3')
    }
    const gone = await fetch('http://127.0.0.1:' + roomPort() + '/stream/' + first)
    assert.equal(gone.status, 404, 'the oldest token is evicted')
  } finally {
    stopParty()
    upstream.close()
  }
})
