import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebSocketServer } from 'ws'
import { joinParty, partyState, stopParty } from '../electron/party/room.ts'

/*
 * 加入失败的三种样子：被房主拒（码不对 / 密码不对）、连不上、连上了没人回话。
 *
 * 这三种以前都只往 error 里写一句话，角色还留在 guest——界面上就是一个 0 人、
 * 没有在播的歌的空房间，退回去再进来还是它。这里钉的是「失败就回入口」：
 * 房间页只在真的进了房之后才出现。
 *
 * 用假房主而不是 startHost：joinParty 开头会先 stopParty，同一个进程里既当
 * 房主又当客人，一 join 就把自己的房间拆了。
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

interface FakeRoom {
  port: number
  close(): void
}

/** 一个只说一句「不行」的假房主。 */
async function refusingRoom(reason: string): Promise<FakeRoom> {
  const server = new WebSocketServer({ port: 0 })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message: { t?: string }
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (message.t !== 'hello') return
      socket.send(JSON.stringify({ t: 'refused', reason }))
      socket.close()
    })
  })
  const address = server.address()
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    close: () => {
      for (const client of server.clients) client.terminate()
      server.close()
    }
  }
}

/** 一个握手就成事的假房主：回一份最小但完整的房间状态。 */
async function acceptingRoom(): Promise<FakeRoom> {
  const server = new WebSocketServer({ port: 0 })
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message: { t?: string }
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (message.t !== 'hello') return
      socket.send(
        JSON.stringify({
          t: 'state',
          state: {
            role: 'host',
            address: '127.0.0.1:1',
            addresses: ['127.0.0.1:1'],
            code: 'PARTY',
            name: '假房间',
            members: [{ id: 'host', name: '房主', host: true }],
            now: null,
            publicAddress: '',
            relay: true,
            locked: true,
            connecting: false,
            refused: '',
            messages: [],
            error: ''
          }
        })
      )
    })
  })
  const address = server.address()
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    close: () => {
      for (const client of server.clients) client.terminate()
      server.close()
    }
  }
}

test('a refused guest lands back on the entry page with the reason kept', async () => {
  const room = await refusingRoom('房间码不对：跟房主再核对一遍那几位')
  try {
    joinParty('127.0.0.1:' + room.port, 'WRONG', '客人')
    /* 连上端口但还没握手成事：这一截只能是「正在连」，不是房间页。 */
    assert.equal(partyState().role, 'guest')
    assert.equal(partyState().connecting, true)

    await waitFor(() => partyState().refused !== '')
    assert.equal(partyState().role, 'idle', 'a refusal must not leave an empty room behind')
    assert.match(partyState().refused, /房间码/)
    assert.match(partyState().error, /房间码/)
  } finally {
    room.close()
    stopParty()
  }
})

test('a refusal caused by the password says so instead of turning into "room closed"', async () => {
  const room = await refusingRoom('房间密码不对：这间房设了口令')
  try {
    joinParty('127.0.0.1:' + room.port, 'PARTY', '客人', 'wrong')
    await waitFor(() => partyState().refused !== '')
    assert.match(partyState().refused, /密码/)
    assert.equal(partyState().role, 'idle')
    /* 房主关连接那一下的 close 不该把原因改写成「房间已关闭」。 */
    assert.doesNotMatch(partyState().error, /房间已关闭/)
  } finally {
    room.close()
    stopParty()
  }
})

test('an unreachable host also ends on the entry page', async () => {
  const room = await refusingRoom('占位')
  const port = room.port
  room.close()
  joinParty('127.0.0.1:' + port, 'PARTY', '客人')
  await waitFor(() => partyState().refused !== '', 6000)
  assert.equal(partyState().role, 'idle')
  assert.match(partyState().error, /连不上/)
})

test('a successful handshake leaves the connecting state behind', async () => {
  const room = await acceptingRoom()
  try {
    joinParty('127.0.0.1:' + room.port, 'party', '客人')
    await waitFor(() => partyState().role === 'guest' && !partyState().connecting)
    assert.equal(partyState().connecting, false)
    assert.equal(partyState().code, 'PARTY')
    /* 房主那边锁着，这一位要跟着状态过来；但密码本身不该在路上。 */
    assert.equal(partyState().locked, true)
    assert.equal(partyState().refused, '')
  } finally {
    room.close()
    stopParty()
  }
})
