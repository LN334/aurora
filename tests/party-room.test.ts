import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { partyState, sendChat, setPublicAddress, setRelay, startHost, stopParty } from '../electron/party/room.ts'

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
