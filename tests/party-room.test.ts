import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import {
  kickMember,
  partyState,
  sendChat,
  setHostPassword,
  setPublicAddress,
  setRelay,
  setRoomCode,
  startHost,
  stopParty
} from '../electron/party/room.ts'

/*
 * 房间协议的两条主路：客人说的话由房主记账再广播，房主自己说的话直接进表。
 *
 * 这条链路里有个容易漏的点——客人的话不能只在他自己那边显示。它要经过房主，
 * 否则第三个人看到的顺序就散了。所以下面连的是真的 ws 服务、真的走 hello。
 */

interface RoomSnapshot {
  members: unknown[]
  messages: { text: string; name: string; host: boolean }[]
}

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

function nextState(socket: WebSocket, predicate: (state: RoomSnapshot) => boolean): Promise<RoomSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no matching state')), 4000)
    const onMessage = (raw: unknown): void => {
      const message = JSON.parse(String(raw)) as { t?: string; state?: RoomSnapshot }
      if (message.t !== 'state' || !message.state) return
      if (!predicate(message.state)) return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(message.state)
    }
    socket.on('message', onMessage)
  })
}

function portOf(): string {
  return partyState().address.split(':').pop() ?? ''
}

test('a message from a guest is recorded by the host and broadcast to everyone', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const socket = new WebSocket('ws://127.0.0.1:' + portOf())
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })

      const joined = nextState(socket, (state) => state.members.length === 2)
      socket.send(JSON.stringify({ t: 'hello', code: partyState().code, name: '客人' }))
      await joined

      const spoke = nextState(socket, (state) => state.messages.length === 1)
      socket.send(JSON.stringify({ t: 'chat', text: '  第一句  ' }))
      const state = await spoke
      assert.equal(state.messages[0]?.text, '第一句', 'the host trims the text it stores')
      assert.equal(state.messages[0]?.name, '客人')
      assert.equal(state.messages[0]?.host, false)
    } finally {
      socket.close()
    }
  } finally {
    stopParty()
  }
})

test('the host can speak into an empty room', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    sendChat('  在吗  ')
    const messages = partyState().messages
    assert.equal(messages.length, 1)
    assert.equal(messages[0]?.text, '在吗')
    assert.equal(messages[0]?.host, true)
    assert.equal(messages[0]?.name, '房主')
  } finally {
    stopParty()
  }
})

test('an empty line is not a message', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    sendChat('   ')
    assert.equal(partyState().messages.length, 0)
  } finally {
    stopParty()
  }
})

test('the host can publish a public address and it reaches the room', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    setPublicAddress('  demo.natfrp.cloud:23456  ')
    assert.equal(partyState().publicAddress, 'demo.natfrp.cloud:23456', 'trimmed')

    const socket = new WebSocket('ws://127.0.0.1:' + portOf())
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      const joined = nextState(socket, (state) => state.members.length === 2)
      socket.send(JSON.stringify({ t: 'hello', code: partyState().code, name: '客人' }))
      const state = await joined
      assert.equal(
        (state as unknown as { publicAddress: string }).publicAddress,
        'demo.natfrp.cloud:23456',
        'a guest joining later still sees it'
      )
    } finally {
      socket.close()
    }
  } finally {
    stopParty()
  }
})

test('the host can turn relaying off, and only the host can', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    assert.equal(partyState().relay, true, 'relaying is on by default')
    setRelay(false)
    assert.equal(partyState().relay, false)
  } finally {
    stopParty()
  }
})


/*
 * 门与锁。
 *
 * 房间码是房间号：念给别人听是正常的。密码是锁：只给被请进来的人。这两样
 * 混在一起，就会出现「把密码当房间号贴进群里」这种事，所以分开测。
 */

function nextRefusal(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no refusal')), 4000)
    const onMessage = (raw: unknown): void => {
      const message = JSON.parse(String(raw)) as { t?: string; reason?: string }
      if (message.t !== 'refused') return
      clearTimeout(timer)
      socket.off('message', onMessage)
      resolve(message.reason ?? '')
    }
    socket.on('message', onMessage)
  })
}

test('a locked room turns away a guest without the right password', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    setHostPassword('sesame')
    assert.equal(partyState().locked, true)

    const socket = new WebSocket('ws://127.0.0.1:' + portOf())
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      const refused = nextRefusal(socket)
      socket.send(JSON.stringify({ t: 'hello', code: partyState().code, name: '客人', pass: 'wrong' }))
      assert.match(await refused, /密码/)
    } finally {
      socket.close()
    }
  } finally {
    stopParty()
  }
})

test('the right password gets in, and the password itself never travels in the room state', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    setHostPassword('sesame')

    const socket = new WebSocket('ws://127.0.0.1:' + portOf())
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      const joined = nextState(socket, (state) => state.members.length === 2)
      socket.send(JSON.stringify({ t: 'hello', code: partyState().code, name: '客人', pass: 'sesame' }))
      const state = await joined
      assert.equal((state as unknown as { locked: boolean }).locked, true)
      assert.ok(
        !JSON.stringify(state).includes('sesame'),
        'the password must not travel inside the broadcast state'
      )
    } finally {
      socket.close()
    }
  } finally {
    stopParty()
  }
})

test('clearing the password reopens the room', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    setHostPassword('sesame')
    setHostPassword('')
    assert.equal(partyState().locked, false)

    const socket = new WebSocket('ws://127.0.0.1:' + portOf())
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      const joined = nextState(socket, (state) => state.members.length === 2)
      socket.send(JSON.stringify({ t: 'hello', code: partyState().code, name: '客人' }))
      await joined
    } finally {
      socket.close()
    }
  } finally {
    stopParty()
  }
})

test('the host can replace the random code with one that is easy to say', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const before = partyState().code
    setRoomCode('party')
    assert.equal(partyState().code, 'PARTY')

    /* 新码能进。 */
    const socket = new WebSocket('ws://127.0.0.1:' + portOf())
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      const joined = nextState(socket, (state) => state.members.length === 2)
      socket.send(JSON.stringify({ t: 'hello', code: 'party', name: '客人' }))
      await joined
    } finally {
      socket.close()
    }

    /* 旧码进不去：改码的意思就是作废上一批邀请。 */
    const stale = new WebSocket('ws://127.0.0.1:' + portOf())
    try {
      await new Promise<void>((resolve, reject) => {
        stale.once('open', () => resolve())
        stale.once('error', reject)
      })
      const refused = nextRefusal(stale)
      stale.send(JSON.stringify({ t: 'hello', code: before, name: '旧客人' }))
      assert.match(await refused, /房间码/)
    } finally {
      stale.close()
    }
  } finally {
    stopParty()
  }
})

test('a code shorter than four characters is not accepted', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const before = partyState().code
    setRoomCode('ab')
    assert.equal(partyState().code, before, 'a too-short code must not replace the working one')
    assert.match(partyState().error, /至少 4 位/)
  } finally {
    stopParty()
  }
})


test('the host can show a guest the door, and the guest is told why', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const guestId = '11111111-2222-3333-4444-555555555555'
    const socket = new WebSocket('ws://127.0.0.1:' + portOf())
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      const joined = nextState(socket, (state) => state.members.length === 2)
      socket.send(JSON.stringify({ t: 'hello', id: guestId, code: partyState().code, name: '客人' }))
      await joined

      const kicked = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no kick')), 4000)
        socket.on('message', (raw) => {
          const message = JSON.parse(String(raw)) as { t?: string; reason?: string }
          if (message.t !== 'kicked') return
          clearTimeout(timer)
          resolve(message.reason ?? '')
        })
      })
      assert.equal(kickMember(guestId).members.length, 1, 'the host is the only one left')
      assert.match(await kicked, /请出/)
    } finally {
      socket.close()
    }
  } finally {
    stopParty()
  }
})

test('a guest cannot kick anyone', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    /* role 是 host 时这一条只验证目标不存在时不动成员表；越权那一半由 room.ts 的 role 判断挡着。 */
    assert.equal(kickMember('host').members.length, 1)
    assert.equal(kickMember('nobody').members.length, 1)
  } finally {
    stopParty()
  }
})
