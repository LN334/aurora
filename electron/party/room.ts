import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { WebSocket, WebSocketServer } from 'ws'

/**
 * 一起听：局域网房间。
 *
 * Aurora 没有服务端，所以房间就开在这台机器的进程里：房主起一个 WebSocket
 * 服务，同一 WiFi 下的人填地址与房间码进来。它同步的是「听什么、听到哪」，
 * 不是音频本身——每台机器各自取流，网络里只走几百字节的状态。
 *
 * 房间码是 32 个不留易混字符（去掉了 0/O/1/I）里取 6 位：既能口头念，也不至于
 * 让同一网段里的陌生人随手猜进来。真正的门槛仍是地址——只有房主那边告诉你的
 * IP:端口 才连得上。
 */

export interface PartyMember {
  id: string
  name: string
  host: boolean
}

/** 房间里「现在在听什么」。trackId 用 `${source}:${onlineId}` 这类跨端稳定的写法。 */
export interface PartyNow {
  trackId: string
  title: string
  artist: string
  /** Unix 毫秒：这条 now 是什么时候发出的。 */
  at: number
  /**
   * 播到第几秒。
   *
   * 房主每隔几秒报一次，客人按 `at` 与它的差算出「此刻该在第几秒」，而不是照抄
   * 这个数——消息在路上走的时间要补回来，否则每报一次就固定慢一截。
   */
  position: number
  playing: boolean
}

export interface PartyState {
  role: 'host' | 'guest' | 'idle'
  /** 房主那台机器的 `IP:端口`。 */
  address: string
  /** 6 位房间码，客人在 hello 里带回来。 */
  code: string
  members: PartyMember[]
  now: PartyNow | null
  /** 最近一次拒绝的原因，给界面用；成功时为空串。 */
  error: string
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

function idle(): PartyState {
  return { role: 'idle', address: '', code: '', members: [], now: null, error: '' }
}

function makeCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return code
}

function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) return item.address
    }
  }
  return '127.0.0.1'
}

type Listener = (state: PartyState) => void

const listeners = new Set<Listener>()
let current: PartyState = idle()

function publish(patch: Partial<PartyState>): void {
  current = { ...current, ...patch }
  for (const listener of listeners) {
    try {
      listener(current)
    } catch {
      // 一个订阅者坏了不该耽误其余界面收到状态。
    }
  }
}

export function onPartyState(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function partyState(): PartyState {
  return current
}

/** 房间内的成员表：socket → 成员。 */
interface Peer {
  id: string
  name: string
  socket: WebSocket
}

const peers = new Map<WebSocket, Peer>()
let hostServer: WebSocketServer | null = null
let hostCode = ''
let hostPort = 0
let guestSocket: WebSocket | null = null

function membersNow(): PartyMember[] {
  const host = current.role === 'host'
  const list: PartyMember[] = []
  if (host) list.push({ id: 'host', name: current.members[0]?.name ?? '房主', host: true })
  for (const peer of peers.values()) list.push({ id: peer.id, name: peer.name, host: false })
  return list
}

/** 广播给房间里所有人（房主自己也走同一条路，界面才只认一个数据源）。 */
function broadcast(state: PartyState): void {
  const payload = JSON.stringify({ t: 'state', state })
  for (const peer of peers.values()) {
    if (peer.socket.readyState === WebSocket.OPEN) peer.socket.send(payload)
  }
}

export function startHost(name: string): PartyState {
  stopParty()
  hostCode = makeCode()
  const server = new WebSocketServer({ host: '0.0.0.0', port: 0 })
  hostServer = server
  server.on('listening', () => {
    const address = server.address()
    hostPort = typeof address === 'object' && address ? address.port : 0
    publish({
      role: 'host',
      address: lanAddress() + ':' + hostPort,
      code: hostCode,
      members: [{ id: 'host', name, host: true }],
      now: null,
      error: ''
    })
  })
  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (message.t === 'hello') {
        if (String(message.code ?? '').toUpperCase() !== hostCode) {
          socket.send(JSON.stringify({ t: 'refused', reason: '房间码不对' }))
          socket.close()
          return
        }
        const peer: Peer = {
          id: randomBytes(4).toString('hex'),
          name: String(message.name ?? '听众').slice(0, 24) || '听众',
          socket
        }
        peers.set(socket, peer)
        socket.send(JSON.stringify({ t: 'state', state: current }))
        publish({ members: membersNow() })
        broadcast(current)
        return
      }
      if (message.t === 'now' && typeof message.now === 'object' && message.now) {
        // 只有房主能改「现在听什么」。
        if (current.role !== 'host') return
        const now = message.now as unknown as PartyNow
        publish({ now })
        broadcast(current)
      }
    })
    socket.on('close', () => {
      peers.delete(socket)
      publish({ members: membersNow() })
      broadcast(current)
    })
    socket.on('error', () => {
      peers.delete(socket)
    })
  })
  return current
}

export function stopParty(): void {
  for (const peer of peers.values()) {
    try {
      peer.socket.close()
    } catch {
      /* 已经断了 */
    }
  }
  peers.clear()
  if (hostServer) {
    hostServer.close()
    hostServer = null
  }
  if (guestSocket) {
    try {
      guestSocket.close()
    } catch {
      /* 已经断了 */
    }
    guestSocket = null
  }
  hostCode = ''
  hostPort = 0
  publish(idle())
}

export function pushNow(now: PartyNow): void {
  if (current.role !== 'host') return
  publish({ now })
  broadcast(current)
}


/**
 * 加入别人的房间。
 *
 * 地址要么 `1.2.3.4:7890`，要么带 `ws://` 前缀；房间码在这里只做大写归一，
 * 认不认是房主那边的事——拒绝理由由房主发回，界面照原样显示。
 */
export function joinParty(url: string, code: string, name: string): PartyState {
  stopParty()
  const trimmed = url.trim()
  if (!trimmed) {
    publish({ error: '先填房主的地址' })
    return current
  }
  const target = /^wss?:\/\//.test(trimmed) ? trimmed : 'ws://' + trimmed
  const socket = new WebSocket(target)
  guestSocket = socket
  publish({ role: 'guest', address: trimmed, code: code.trim().toUpperCase(), error: '' })

  socket.on('open', () => {
    socket.send(JSON.stringify({ t: 'hello', code: code.trim().toUpperCase(), name }))
  })

  socket.on('message', (raw) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.t === 'refused') {
      publish({ error: String(message.reason ?? '房主拒绝了这次加入') })
      return
    }
    if (message.t === 'state' && message.state && typeof message.state === 'object') {
      const incoming = message.state as unknown as PartyState
      publish({ ...incoming, role: 'guest', address: trimmed, error: '' })
    }
  })

  socket.on('error', () => {
    publish({ error: '连不上房主，检查地址与是否在同一网络' })
  })

  socket.on('close', () => {
    if (current.role === 'guest') {
      guestSocket = null
      publish({ ...idle(), error: '房间已关闭' })
    }
  })

  return current
}
