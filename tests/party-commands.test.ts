import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { partyState, startHost, stopParty } from '../electron/party/room.ts'

/*
 * 房间的写权限与回声。
 *
 * 这一版把「谁能改播放」放平了：房主的暂停、客人的暂停都算数。放平之后要证明
 * 两件事——别人的命令真的能落地；以及「跟着别人变」的那一次不会再被当成新命令
 * 推回去（否则两个客户端会你暂停我、我暂停你，播放键自己跳）。
 *
 * 测法是真的开房间、连 ws、发协议消息。命令的等价判断在房主进程里，纯函数测
 * 不到它。
 */

interface NowFrame {
  trackId: string
  playing: boolean
  position: number
  seq?: number
  why?: string
}

interface RoomFrame {
  now: NowFrame | null
  queue: { id: string; title: string }[]
  rev: number
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

/** 连上房间，说 hello，并把之后收到的每一份 state 记下来。 */
async function joinRoom(): Promise<{ socket: WebSocket; frames: RoomFrame[] }> {
  startHost('房主')
  await waitFor(() => partyState().address !== '')
  const port = partyState().address.split(':').pop() ?? ''
  const socket = new WebSocket('ws://127.0.0.1:' + port)
  const frames: RoomFrame[] = []
  socket.on('message', (raw: unknown) => {
    const message = JSON.parse(String(raw)) as { t?: string; state?: RoomFrame }
    if (message.t === 'state' && message.state) frames.push(message.state)
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  socket.send(JSON.stringify({ t: 'hello', code: partyState().code, name: '客人' }))
  await waitFor(() => frames.some((frame) => frame.now === null && frame.queue.length === 0))
  await waitFor(() => partyState().members.length === 2)
  return { socket, frames }
}

function nowFrame(patch: Partial<NowFrame> & { trackId: string }): NowFrame {
  return { at: Date.now(), position: 0, playing: true, ...patch }
}

test('a guest can pause the room, and the frame carries a monotonic seq', async () => {
  const { socket, frames } = await joinRoom()
  try {
    socket.send(
      JSON.stringify({ t: 'now', now: nowFrame({ trackId: 'netease:1', why: 'state', playing: false }) })
    )
    await waitFor(() => frames.some((frame) => frame.now?.trackId === 'netease:1'))
    const first = frames.filter((frame) => frame.now?.trackId === 'netease:1').pop()
    assert.equal(first?.now?.playing, false, 'the guest pause landed')
    assert.ok((first?.now?.seq ?? 0) > 0, 'the host stamps a seq')
    assert.equal(first?.rev, first?.now?.seq, 'rev and seq share one counter')
  } finally {
    socket.close()
    stopParty()
  }
})

test('a guest command that repeats the room state is absorbed, not rebroadcast', async () => {
  const { socket, frames } = await joinRoom()
  try {
    socket.send(JSON.stringify({ t: 'now', now: nowFrame({ trackId: 'netease:1', why: 'state', playing: false }) }))
    await waitFor(() => frames.some((frame) => frame.now?.playing === false))
    const before = frames.filter((frame) => frame.now?.trackId === 'netease:1').pop()
    const seq = before?.now?.seq ?? 0

    /*
     * 模仿「跟着房主被暂停」的那一次上报：状态已经一致。房主应当原样丢掉，
     * 不盖新号、不广播——不然每跟一次就多一轮回声。
     */
    const count = frames.length
    socket.send(JSON.stringify({ t: 'now', now: nowFrame({ trackId: 'netease:1', why: 'state', playing: false }) }))
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(frames.length, count, 'nothing new was broadcast')
    assert.equal(frames.filter((frame) => frame.now?.trackId === 'netease:1').pop()?.now?.seq, seq)
  } finally {
    socket.close()
    stopParty()
  }
})

test('the same song queued twice only lands once', async () => {
  const { socket, frames } = await joinRoom()
  try {
    const item = { id: 'netease:1', source: 'netease', title: '第一首', artist: '某人', album: '', duration: 180000, coverUrl: null, hasArt: false }
    socket.send(JSON.stringify({ t: 'queue', op: 'add', item }))
    await waitFor(() => frames.some((frame) => frame.queue.length === 1))
    socket.send(JSON.stringify({ t: 'queue', op: 'add', item }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(frames[frames.length - 1]?.queue.length, 1, 'no duplicate row')
  } finally {
    socket.close()
    stopParty()
  }
})

test('a guest can drop something from the room queue', async () => {
  const { socket, frames } = await joinRoom()
  try {
    socket.send(
      JSON.stringify({
        t: 'queue',
        op: 'add',
        item: { id: 'qq:2', source: 'qq', title: '第二首', artist: '', album: '', duration: 200000, coverUrl: null, hasArt: false }
      })
    )
    await waitFor(() => frames.some((frame) => frame.queue.length === 1))
    socket.send(JSON.stringify({ t: 'queue', op: 'remove', id: 'qq:2' }))
    await waitFor(() => frames[frames.length - 1]?.queue.length === 0)
  } finally {
    socket.close()
    stopParty()
  }
})

test('playing a row of the room queue hands it to everyone and takes it out of the queue', async () => {
  const { socket, frames } = await joinRoom()
  try {
    socket.send(
      JSON.stringify({
        t: 'queue',
        op: 'add',
        item: { id: 'kugou:3', source: 'kugou', title: '第三首', artist: '', album: '', duration: 240000, coverUrl: null, hasArt: false }
      })
    )
    await waitFor(() => frames.some((frame) => frame.queue.length === 1))
    socket.send(JSON.stringify({ t: 'queue', op: 'play', id: 'kugou:3' }))
    await waitFor(() => frames.some((frame) => frame.now?.trackId === 'kugou:3'))
    const last = frames[frames.length - 1]
    assert.equal(last?.queue.length, 0, 'the row moved from the queue to the now line')
    assert.equal(last?.now?.playing, true)
    assert.equal(last?.now?.why, 'track')
  } finally {
    socket.close()
    stopParty()
  }
})

test('two guests: one pauses, the other follows, and the follow does not echo back', async () => {
  startHost('房主')
  try {
    await waitFor(() => partyState().address !== '')
    const port = partyState().address.split(':').pop() ?? ''
    const frames: RoomFrame[] = []
    const connect = async (name: string): Promise<WebSocket> => {
      const socket = new WebSocket('ws://127.0.0.1:' + port)
      socket.on('message', (raw: unknown) => {
        const message = JSON.parse(String(raw)) as { t?: string; state?: RoomFrame }
        if (message.t === 'state' && message.state) frames.push(message.state)
      })
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })
      socket.send(JSON.stringify({ t: 'hello', code: partyState().code, name }))
      return socket
    }

    const a = await connect('甲')
    const b = await connect('乙')
    try {
      await waitFor(() => partyState().members.length === 3)

      /* 甲先放一首，两个人都在听。 */
      a.send(JSON.stringify({ t: 'now', now: nowFrame({ trackId: 'netease:9', why: 'track', playing: true }) }))
      await waitFor(() => frames.some((frame) => frame.now?.trackId === 'netease:9' && frame.now.playing))

      /* 甲按暂停。 */
      a.send(JSON.stringify({ t: 'now', now: nowFrame({ trackId: 'netease:9', why: 'state', playing: false }) }))
      await waitFor(() => frames.some((frame) => frame.now?.trackId === 'netease:9' && frame.now.playing === false))
      const pausedAt = frames[frames.length - 1]?.now?.seq ?? 0
      const count = frames.length

      /*
       * 乙这边是被广播推着暂停的；它的 watcher 会看到一次「起停变了」。然后它
       * 按规矩上报了一次——与房间当前状态一模一样。房主必须原样丢掉。
       */
      b.send(JSON.stringify({ t: 'now', now: nowFrame({ trackId: 'netease:9', why: 'state', playing: false }) }))
      await new Promise((resolve) => setTimeout(resolve, 250))
      assert.equal(frames.length, count, 'the echoed pause was absorbed, nothing rebroadcast')
      assert.equal(frames[frames.length - 1]?.now?.seq, pausedAt, 'no new seq for a no-op')

      /* 但乙真心按播放时，这条必须生效——放开的是控制权，不是把命令吞掉。 */
      b.send(JSON.stringify({ t: 'now', now: nowFrame({ trackId: 'netease:9', why: 'state', playing: true }) }))
      await waitFor(() =>
        frames.some(
          (frame) =>
            frame.now?.trackId === 'netease:9' &&
            frame.now.playing &&
            (frame.now.seq ?? 0) > pausedAt
        )
      )
      const resumed = frames[frames.length - 1]?.now?.seq ?? 0
      assert.ok(resumed > pausedAt, 'a real command still gets a newer seq')
    } finally {
      a.close()
      b.close()
    }
  } finally {
    stopParty()
  }
})
