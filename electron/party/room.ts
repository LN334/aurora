import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { Readable } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { upstreamHeaders } from '../upstream-headers.ts'

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
  /** 这首歌是什么；客人队列里没有它时靠它就地装进来。 */
  track?: {
    id: string
    source: string
    title: string
    artist: string
    album: string
    duration: number
    coverUrl: string | null
    hasArt: boolean
  }
  /** 房主那份播放地址；有它，客人听到的就是房主这一档的音质。 */
  /**
   * 房主这份流。
   *
   * `relay` 时 `url` 只放路径（`/stream/<令牌>`），主机交给客人自己补：他连进来
   * 用的哪个地址就走哪个。同一个 WiFi 的客人不该为了听歌绕到公网再回来。
   */
  stream?: { url: string; quality: string; via?: 'relay' | 'direct' }
}

/** 房间里的一句话。 */
export interface PartyMessage {
  id: string
  /** 发言者显示名。 */
  name: string
  text: string
  /** Unix 毫秒。 */
  at: number
  /** 房主说的话，界面上靠另一边。 */
  host: boolean
}

export interface PartyState {
  role: 'host' | 'guest' | 'idle'
  /** 房主那台机器的 `IP:端口`（候选里的第一个）。 */
  address: string
  /**
   * 房主这台机器所有可用的 `IP:端口` 候选。
   *
   * 多网卡时第一个未必是客人能到的那个，列出来让房主挑。
   */
  addresses: string[]
  /** 6 位房间码，客人在 hello 里带回来。 */
  code: string
  members: PartyMember[]
  now: PartyNow | null
  /**
   * 公网地址（`host:端口`），房主填。
   *
   * 房间本身只监听局域网；要让外面的人进来，得有人把端口暴露到公网——樱花
   * 内网穿透那类工具。房主在自己那边开好隧道后把地址填进来，客人才知道该往
   * 哪儿连。空串表示没有公网入口。
   */
  publicAddress: string
  /**
   * 房主是否替房间转发音频。
   *
   * 开着才有「音质同步」：客人听到的是房主那份流。关掉之后两边各取各的，
   * 客人没账号就听不到——这是一个明确的取舍，不是隐藏开关。
   */
  relay: boolean
  /**
   * 房间里最近的话。
   *
   * 跟着 state 一起走，所以中途进来的人也能看到上一段——否则每次有人加入，
   * 房间的记忆就断一次。只留最近几十条，再多就该滑动条了。
   */
  messages: PartyMessage[]
  /** 最近一次拒绝的原因，给界面用；成功时为空串。 */
  error: string
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/**
 * 这台机器在房间里的身份。
 *
 * 之前每个成员 id 都是进房时现生成的随机串，断线重连就换一个人。这里发一个
 * UUID 存进用户目录，之后一直用它——认得出来人，才谈得上好友。
 *
 * 用 APPDATA 而不是 electron 的 app.getPath：这个文件也会被 node --test 直接
 * import，那里没有 electron。
 */
let cachedIdentity: string | null = null

function partyIdentity(): string {
  if (cachedIdentity) return cachedIdentity
  const base = process.env.APPDATA || process.env.HOME || '.'
  const file = join(base, 'aurora-player', 'party-identity')
  try {
    const existing = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f-]{36}$/i.test(existing)) {
      cachedIdentity = existing
      return cachedIdentity
    }
  } catch {
    /* 第一次进房 */
  }
  const fresh = randomUUID()
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, fresh, 'utf8')
  } catch {
    /* 写不下去就只用这一次的内存值 */
  }
  cachedIdentity = fresh
  return cachedIdentity
}

const CODE_LENGTH = 6

function idle(): PartyState {
  return {
    role: 'idle',
    address: '',
    addresses: [],
    code: '',
    members: [],
    now: null,
    publicAddress: '',
    relay: true,
    messages: [],
    error: ''
  }
}

/** 一条消息最多这么多个字。 */
const MESSAGE_MAX = 200

/** 房间里留最近多少条。 */
const MESSAGES_KEPT = 30

/**
 * 聊天文本：去掉控制字符、把连续空白压成一个、限长。
 *
 * 房主与客人的消息都过这一道。谁都能发，不收口的话，一条带两千个换行的
 * 消息就能让房间里所有人的面板同时跳一下。
 */
export function cleanChatText(raw: string): string {
  const flat = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  /* 按码点截，不按 UTF-16 单元：一刀切在代理对中间会留下半个 emoji。 */
  return [...flat].slice(0, MESSAGE_MAX).join('')
}

function makeCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let code = ''
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return code
}

/**
 * 这台机器的全部局域网地址。
 *
 * 只取第一个是错的：装了 VPN、开了虚拟机、插了第二个网卡，`networkInterfaces`
 * 的顺序并不保证第一个就是客人能到的那个。所以把候选都列出来让房主挑，而不是
 * 替他猜一个——猜错的表现是「我这明明开着房，他说连不上」。
 */
function lanAddresses(): string[] {
  const found: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal && !found.includes(item.address)) {
        found.push(item.address)
      }
    }
  }
  return found.length ? found : ['127.0.0.1']
}

function lanAddress(): string {
  return lanAddresses()[0] as string
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

/** 往房间里放一句话，然后广播出去。 */
function appendMessage(message: PartyMessage): void {
  publish({ messages: [...current.messages, message].slice(-MESSAGES_KEPT) })
  broadcast(current)
}

/**
 * 房主这一侧能转发的流。
 *
 * 有些平台的直链认 IP 或一次性 token，客人拿去放不出声。房主在自己机器上代拉、
 * 再原样转出去，平台看到的是房主的 IP，客人拿到的就是我们自己这条地址——
 * 走同一个房间端口，穿透怎么连的，音频就怎么走。
 */
interface StreamEntry {
  trackId: string
  url: string
  headers: Record<string, string>
}

/** 令牌 → 流；以及歌 → 令牌，同一首重复登记时复用同一个地址。 */
const streams = new Map<string, StreamEntry>()
const tokenOfTrack = new Map<string, string>()
let hostHttp: Server | null = null

/**
 * 登记最多这么多首。
 *
 * 地址里带的是一个随机令牌，不是 `netease:123` 这种能猜的东西——房间码只挡住
 * 进房，挡不住有人照着规律拼一个 /stream/ 地址来白拿音频。令牌也不长期保留：
 * 换过的歌留一小段（客人可能往回跳），再旧的就丢掉。
 */
const STREAMS_KEPT = 20

/** 房主取流成功后登记一份，返回转发地址里那个令牌。 */
export function registerStream(
  trackId: string,
  url: string,
  headers: Record<string, string> = {}
): string {
  const reused = tokenOfTrack.get(trackId)
  const token = reused ?? randomBytes(8).toString('hex')
  tokenOfTrack.set(trackId, token)
  streams.set(token, { trackId, url, headers })
  while (streams.size > STREAMS_KEPT) {
    const oldest = streams.keys().next().value
    if (oldest === undefined) break
    const gone = streams.get(oldest)
    streams.delete(oldest)
    if (gone && tokenOfTrack.get(gone.trackId) === oldest) tokenOfTrack.delete(gone.trackId)
  }
  return token
}

/** 换房间时清空，免得把上一个房间的地址留在表里。 */
export function clearStreams(): void {
  streams.clear()
  tokenOfTrack.clear()
  activeByClient.clear()
}

async function proxyStream(
  entry: { url: string; headers: Record<string, string> },
  request: { headers: Record<string, string | string[] | undefined> },
  response: import('node:http').ServerResponse
): Promise<void> {
  try {
    /*
     * 和页面侧那条代理用同一套头：UA 一定要有，抖音系与 B 站还要来源站。
     * 少了这些，平台回 403——转发看起来通了，客人听到的却是错误。
     */
    const range = typeof request.headers.range === 'string' ? request.headers.range : null
    const headers = { ...upstreamHeaders(entry.url, range), ...entry.headers }
    const upstream = await fetch(entry.url, { headers })
    const out: Record<string, string> = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
    const type = upstream.headers.get('content-type')
    if (type) out['Content-Type'] = type
    const length = upstream.headers.get('content-length')
    if (length) out['Content-Length'] = length
    const contentRange = upstream.headers.get('content-range')
    if (contentRange) out['Content-Range'] = contentRange
    response.writeHead(upstream.status, out)
    if (!upstream.body) {
      response.end()
      return
    }
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(response)
  } catch {
    response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('上游取流失败')
  }
}

/**
 * 同一台机器同时能开几条转发。
 *
 * 转发是房主自己出的上行，不是平台白给的带宽。一个客人拖动进度条会让浏览器
 * 连续开几条 Range 请求；几个人一起拖，房主这边的上行就被这些连接占满了，
 * 他自己放歌都会卡。所以按「每个来源地址最多两条」限一下，超了直接 429——
 * 播放器会重试，人也能看出是在忙而不是坏了。
 */
const MAX_STREAMS_PER_CLIENT = 2
const activeByClient = new Map<string, number>()

function handleHttp(
  request: import('node:http').IncomingMessage,
  response: import('node:http').ServerResponse
): void {
  const url = new URL(request.url ?? '/', 'http://room.local')
  if (!url.pathname.startsWith('/stream/')) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('not found')
    return
  }
  const token = decodeURIComponent(url.pathname.slice('/stream/'.length))
  const entry = streams.get(token)
  if (!entry) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('这首歌没有登记转发')
    return
  }

  const client = request.socket.remoteAddress ?? 'unknown'
  const running = activeByClient.get(client) ?? 0
  if (running >= MAX_STREAMS_PER_CLIENT) {
    response.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '1' })
    response.end('这一头同时拉取太多，稍后再试')
    return
  }
  activeByClient.set(client, running + 1)
  const release = (): void => {
    const left = (activeByClient.get(client) ?? 1) - 1
    if (left <= 0) activeByClient.delete(client)
    else activeByClient.set(client, left)
  }
  response.once('close', release)
  response.once('finish', release)
  void proxyStream(entry, request, response)
}

/**
 * 开房。
 *
 * `port` 给了就固定监听它——这一条是「樱花与房间绑定」的前提：隧道里填的本地
 * 端口是写死的，房间每次换一个随机端口，房主就得回樱花面板改一次。固定之后，
 * 隧道配一次就够了。端口被占用时退回随机，并在状态里把实际端口带出去。
 */
export function startHost(name: string, port = 0): PartyState {
  stopParty()
  hostCode = makeCode()
  /*
   * 一个 HTTP 服务同时干两件事：房间本身走 WebSocket 升级，/stream/<id> 走
   * 音频转发。合成一个端口是必须的——内网穿透只映射一条隧道，两条端口会让
   * 房主还得再建一条。
   */
  const http = createServer(handleHttp)
  hostHttp = http
  const server = new WebSocketServer({ server: http })
  hostServer = server
  /*
   * 想要的端口被占（上一个实例没退干净、别的程序占着），退回随机端口。
   * 这里不要报错让房主去查：端口是给他照着填隧道的，能开起来更重要。
   */
  http.once('error', () => {
    if (hostHttp !== http) return
    try {
      http.listen(0, '0.0.0.0')
    } catch {
      /* 连随机端口都开不了，下面 listening 不会来，界面停在 idle */
    }
  })
  /*
   * 先把「我是房主」定下来，端口等监听成功再补。
   *
   * 之前整条 publish 都在 listening 回调里，IPC 同步返回的还是 idle：界面照旧
   * 显示「开一个房间」，要等一次广播回来才换脸。广播慢一点或丢了，用户看到的
   * 就是「点了没反应」。角色与端口是两件事，不该绑在一起等。
   */
  publish({
    role: 'host',
    address: '',
    addresses: [],
    code: hostCode,
    members: [{ id: 'host', name, host: true }],
    now: null,
    publicAddress: '',
    relay: true,
    messages: [],
    error: ''
  })

  http.listen(port, '0.0.0.0')
  http.on('listening', () => {
    const address = http.address()
    hostPort = typeof address === 'object' && address ? address.port : 0
    publish({
      address: lanAddress() + ':' + hostPort,
      addresses: lanAddresses().map((ip) => ip + ':' + hostPort)
    })
    broadcast(current)
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
          /* 客人自报的稳定 id：认得出来人，才谈得上好友。没有就退回随机。 */
          id: /^[0-9a-f-]{36}$/i.test(String(message.id ?? ''))
            ? String(message.id)
            : randomBytes(4).toString('hex'),
          name: String(message.name ?? '听众').slice(0, 24) || '听众',
          socket
        }
        peers.set(socket, peer)
        socket.send(JSON.stringify({ t: 'state', state: current }))
        publish({ members: membersNow() })
        broadcast(current)
        return
      }
      if (message.t === 'chat') {
        /*
         * 客人说的话由房主这边落进消息表：真正的房间状态只有一份，谁说了什么
         * 都要经过服务端，不然两个客人各说各的，第三个人看到的顺序就散了。
         */
        const peer = peers.get(socket)
        if (!peer) return
        const text = cleanChatText(String(message.text ?? ''))
        if (!text) return
        appendMessage({
          id: randomBytes(6).toString('hex'),
          name: peer.name,
          text,
          at: Date.now(),
          host: false
        })
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
  clearStreams()
  if (hostHttp) {
    try {
      hostHttp.close()
    } catch {
      /* 已经关了 */
    }
    hostHttp = null
  }
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

/**
 * 房主填公网地址。
 *
 * 只有房主能改：客人那边填了也不该影响别人看到的房间信息。
 */
export function setPublicAddress(raw: string): void {
  if (current.role !== 'host') return
  publish({ publicAddress: raw.trim().slice(0, 80) })
  broadcast(current)
}

/** 房主开关转发。客人调用无效果。 */
export function setRelay(value: boolean): void {
  if (current.role !== 'host' || current.relay === value) return
  publish({ relay: value })
  broadcast(current)
}

export function pushNow(now: PartyNow): void {
  if (current.role !== 'host') return
  publish({ now })
  broadcast(current)
}

/**
 * 房间里说一句话。
 *
 * 房主这边直接进消息表；客人这边只是把话交给房主，等那边的广播回来才显示。
 * 不做本地回显——同一条话走两条路回来会变成两句。
 */
export function sendChat(raw: string): void {
  const text = cleanChatText(raw)
  if (!text) return
  if (current.role === 'host') {
    appendMessage({
      id: randomBytes(6).toString('hex'),
      name: current.members[0]?.name ?? '房主',
      text,
      at: Date.now(),
      host: true
    })
    return
  }
  if (current.role === 'guest' && guestSocket?.readyState === WebSocket.OPEN) {
    guestSocket.send(JSON.stringify({ t: 'chat', text }))
  }
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
  /* 界面上那一行是给人看的：wss:// 前缀对判断「连没连上」没有帮助。 */
  const shown = trimmed.replace(/^wss?:\/\//i, '')
  publish({ role: 'guest', address: shown, code: code.trim().toUpperCase(), error: '' })

  /*
   * 握上手却迟迟没有一份状态——多半是两边版本对不上，或者房主那边卡住了。
   *
   * 之前这种情况界面就一直停在「正在加入的一起听 · 0 人」，用户只能猜是网、
   * 是码、还是对面根本没开。等六秒给一句能照做的话，比一直转圈有用。
   */
  let heard = false
  const waitTimer = setTimeout(() => {
    if (heard || guestSocket !== socket) return
    publish({ error: '连上了，但房主没有回话：确认两台版本一致，或者让房主重开一次房间' })
  }, 6000)

  socket.on('open', () => {
    socket.send(JSON.stringify({ t: 'hello', id: partyIdentity(), code: code.trim().toUpperCase(), name }))
  })

  socket.on('message', (raw) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.t === 'refused') {
      clearTimeout(waitTimer)
      publish({ error: String(message.reason ?? '房主拒绝了这次加入') })
      return
    }
    if (message.t === 'state' && message.state && typeof message.state === 'object') {
      heard = true
      clearTimeout(waitTimer)
      const incoming = message.state as unknown as PartyState
      publish({ ...incoming, role: 'guest', address: shown, error: '' })
    }
  })

  socket.on('error', () => {
    clearTimeout(waitTimer)
    // 公网场景下「是否在同一网络」是句错话：地址、房间码、隧道任一处不对都连不上。
    publish({ error: '连不上房主：检查地址与房间码，房主那边如果走的是公网，还要确认隧道开着' })
  })

  socket.on('close', () => {
    clearTimeout(waitTimer)
    if (current.role === 'guest') {
      guestSocket = null
      publish({ ...idle(), error: '房间已关闭：房主结束了这一趟，或者他那边断网、隧道断了' })
    }
  })

  return current
}
