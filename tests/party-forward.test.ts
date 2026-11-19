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
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '5' })
    response.end('AUDIO')
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamPort = (upstream.address() as { port: number }).port

  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    registerStream('netease:1', 'http://127.0.0.1:' + upstreamPort + '/a.mp3')

    const response = await fetch('http://127.0.0.1:' + roomPort() + '/stream/' + encodeURIComponent('netease:1'))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'audio/mpeg')
    assert.equal(await response.text(), 'AUDIO')
  } finally {
    stopParty()
    upstream.close()
  }
})

test('an unregistered track is a 404, not a hang', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const response = await fetch('http://127.0.0.1:' + roomPort() + '/stream/' + encodeURIComponent('netease:404'))
    assert.equal(response.status, 404)
  } finally {
    stopParty()
  }
})
