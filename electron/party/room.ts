import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { Readable } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { upstreamHeaders } from '../upstream-headers.ts'
import { cleanCode } from './code.ts'
import { startAnswering, stopAnswering } from './discover.ts'
import { addToQueue, moveInQueue, removeFromQueue } from './queue.ts'

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

/**
 * 队列里的一首歌。
 *
 * 与 `PartyNow.track` 同一份形状：房间同步的是「听什么」，各端自己解析流。
 * 本机文件也占一位（不给播放地址），这样两边的队列长度与顺序才对得上。
 */
export interface PartyQueueItem {
  id: string
  source: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string | null
  hasArt: boolean
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
  /**
   * 房间给这条「现在」排的号，由房主那一份状态单调递增。
   *
   * 以前谁后到谁赢：两个人几乎同时按下去，两条消息在路上交错，各自先按自己的
   * 那份执行，再被对方那条拉回来——看起来就是两个人在抢播放键。有了号，收到
   * 比自己已经应用过的更旧的号就直接丢，迟到的消息没法把状态倒回去。
   *
   * 没有号（老版本房主）时按 0 处理，行为与以前一致。
   */
  seq?: number
  /**
   * 这条变化是哪一类：换歌、起停、拖进度，还是房主的定时心跳。
   *
   * 有它，房主才能做等价判断：一个人按暂停、别人跟着被暂停，别人那一份
   * 「暂停」回来时与房间当前状态一模一样，原样丢掉——不盖新号，也不再回推。
   * 少了这一道，两个客户端会你报一次、我报一次，播放键自己跳个不停。
   */
  why?: 'track' | 'state' | 'seek' | 'tick'
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
  /**
   * 房间名，房主起。
   *
   * 空串是「还没起名」，界面显示默认的那句；不能拿它当「房间叫空字符串」——
   * 客人看到标题是空的会以为没连上。
   */
  name: string
  members: PartyMember[]
  now: PartyNow | null
  /**
   * 房间的播放队列，由房主定。
   *
   * 以前只同步「现在这一首」，两边的队列各是各的：房主点下一首是一个序列，
   * 客人点下一首落到另一首上，切歌越多分叉越大。现在整条队列跟着房间走，
   * 「下一首 / 上一首」在两边指的是同一首。
   */
  queue: PartyQueueItem[]
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
   * 房间有没有上锁。
   *
   * 密码本身不出主进程：广播给客人的状态里只有这一位。设了密码的房间，新人
   * 得在 hello 里带上它；已经在房里的人不受影响——改密码不是踢人。
   */
  locked: boolean
  /**
   * 客人这一侧：还没收到房主的第一份状态。
   *
   * 加入是两段——连上端口，和握手成事。中间这一截如果直接显示房间页，用户
   * 看到的就是一个「0 人、没有在播的歌」的空房间；连不上的话，这个空房间
   * 还会一直挂着，看起来像进成功了一个没人的房。
   */
  connecting: boolean
  /**
   * 被房主拒掉的原因；空串表示没被拒过。
   *
   * 和 `error` 分开：`error` 是给人看的一句话，这一位是给界面判断用的
   * 「门没开」——被拒之后不该再替用户自动重连同一个房间。
   */
  refused: string
  /**
   * 房间里最近的话。
   *
   * 跟着 state 一起走，所以中途进来的人也能看到上一段——否则每次有人加入，
   * 房间的记忆就断一次。只留最近几十条，再多就该滑动条了。
   */
  messages: PartyMessage[]
  /**
   * 房间状态的版本号，每次播放或队列真的变了才 +1。
   *
   * 与 `now.seq` 同一个计数器：一条状态广播里的 `rev` 就是它里面那份
   * `now.seq`。界面与客户端拿它判断「这条比我已经应用过的旧不旧」。
   */
  rev: number
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
    /* 房间名：房主起的，空串表示还没起，界面用默认那句。 */
    name: '',
    members: [],
    now: null,
    queue: [],
    publicAddress: '',
    relay: true,
    locked: false,
    connecting: false,
    refused: '',
    messages: [],
    rev: 0,
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

/* 房间码归一放在 code.ts：房间与局域网发现两边都要用同一套规则。 */

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
/**
 * 房主设的进房口令；空串表示这间房不上锁。
 *
 * 只活在内存里：房间本身也是临时的，关了就该忘掉。它也不进 `PartyState`——
 * 那份状态会广播给房间里所有人，密码放进去等于当场告诉每个客人。
 */
let hostPassword = ''
let hostPort = 0
let guestSocket: WebSocket | null = null
/**
 * 房间状态的版本号。
 *
 * 每条真的改变了「在听什么」或「接下来放什么」的命令 +1；同一条命令的两次
 * 广播共用一个号。它只在房主进程里有意义——房间状态的唯一一份就在那儿。
 */
let roomRev = 0

function stampRev(): number {
  roomRev += 1
  return roomRev
}

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
    name: '',
    members: [{ id: 'host', name, host: true }],
    now: null,
    publicAddress: '',
    relay: true,
    locked: false,
    connecting: false,
    refused: '',
    messages: [],
    rev: 0,
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
    /*
     * 同一网络里凭房间码就能找过来：朋友不必再抄一遍 `IP:端口`。
     *
     * lookup 是现取的——房间名、密码、端口在房间活着的时候都能改，缓存一份
     * 就会出现「明明改了名，朋友还是看到旧名字」。
     */
    startAnswering(() =>
      hostPort
        ? { code: hostCode, port: hostPort, name: current.name, locked: hostPassword !== '' }
        : null
    )
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
        /*
         * 两道门，先房再锁。
         *
         * 房间码是房间号，念给别人听是正常的；密码是锁，只给被邀请的人。
         * 先核房号再核口令，拒绝的理由才对得上——码都没对上的人，不必知道
         * 这间房有没有设口令。
         */
        if (cleanCode(String(message.code ?? '')) !== hostCode) {
          socket.send(JSON.stringify({ t: 'refused', reason: '房间码不对：跟房主再核对一遍那几位' }))
          socket.close()
          return
        }
        if (hostPassword && String(message.pass ?? '') !== hostPassword) {
          socket.send(JSON.stringify({ t: 'refused', reason: '房间密码不对：这间房设了口令' }))
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
      /*
       * 「在听什么」谁都能改，但只有房主这一份进程能落定。
       *
       * 这是这一版与之前最大的不同：以前客人只被允许切歌，暂停与拖动只有房主
       * 说了算——「不想限制房客」就是把这三种放平。放平之后靠的不是权限，而是
       * 这里的串行 + 排号：两条命令按到达顺序各得一个更号，客户端丢掉更旧的，
       * 于是不会出现「你拉我、我拉你」。
       */
      if (message.t === 'now' && typeof message.now === 'object' && message.now) {
        if (current.role !== 'host') return
        publishNow(message.now as unknown as PartyNow)
        return
      }
      if (message.t === 'queue') {
        if (current.role !== 'host') return
        applyQueueCommand(String(message.op ?? ''), message)
        return
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
  /* 房间关了就不该再答话：留着的话，朋友会找到一个连不上的「房间」。 */
  stopAnswering()
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
  hostPassword = ''
  hostPort = 0
  /* 房间重开之后号要从头数：留着上一个房间的号，新客人的第一条命令会被当成旧的。 */
  roomRev = 0
  publish(idle())
}

/**
 * 房主填公网地址。
 *
 * 只有房主能改：客人那边填了也不该影响别人看到的房间信息。
 */
export function setPublicAddress(raw: string): void {
  if (current.role !== 'host') return
  const trimmed = raw.trim().slice(0, 120)
  if (!trimmed) {
    publish({ publicAddress: '' })
    broadcast(current)
    return
  }
  /*
   * 两种写法，对应两种隧道：
   *
   *   host:port   —— 直连 TCP 隧道的端口，ws://host:port
   *   wss://域名  —— 走 HTTPS 的隧道（樱花 HTTP 隧道绑定自己的域名），443
   *
   * 只写裸域名不行：默认 80 口，免费节点对「直接用节点域名访问」一律回 503
   * （节点域名没备案），房主在浏览器里看到 503 会以为是隧道坏了。而 wss://
   * 是明确的，不许省——省掉就退回上面那个坏情况。
   */
  const secure = /^wss:\/\//i.test(trimmed)
  const rest = trimmed
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  const withPort = /^[a-z0-9.-]+:\d{1,5}$/i.test(rest)
  const hostOnly = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(rest)
  if (!withPort && !(secure && hostOnly)) {
    publish({ error: '公网地址填「域名:端口」，或者「wss://你的域名」' })
    return
  }
  publish({ publicAddress: secure ? 'wss://' + rest : rest })
  broadcast(current)
}

/**
 * 房主给房间起名。
 *
 * 空串等于恢复默认，不是「一个没有名字的房间」——标题空着比没有标题更让人担心。
 * 客人那边调用无效果：名字是房间的属性，不是谁的偏好。
 */
export function renameRoom(raw: string): void {
  if (current.role !== 'host') return
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 24)
  if (name === current.name) return
  publish({ name })
  broadcast(current)
}

/**
 * 房主把房间码改成自己好念的那一串。
 *
 * 随机码的问题不是不好猜，是不好念：`K7QMX2` 在电话里要念半天。改成
 * `PARTY` 之后一句话就说完，同一条邀请两个人念出来还是一个东西。
 *
 * 只收字母与数字、4–8 位。放任更长更花，念错的概率只会跟着涨——这个码是
 * 给人念的，不是给机器存的。
 */
export function setRoomCode(raw: string): PartyState {
  if (current.role !== 'host') return current
  const next = cleanCode(raw)
  if (next.length < 4) {
    publish({ error: '房间码至少 4 位，只能是字母和数字' })
    return current
  }
  if (next === hostCode) return current
  hostCode = next
  publish({ code: next, error: '' })
  broadcast(current)
  return current
}

/**
 * 房主给房间上锁。
 *
 * 空串是解锁，不是「设一个空密码」。锁定只影响**接下来**要进的人：已经在
 * 房里的人不会被赶出去——改口令是为了挡住陌生人，不是为了踢熟人。
 */
export function setHostPassword(raw: string): PartyState {
  if (current.role !== 'host') return current
  const next = raw.trim().slice(0, 32)
  if (next === hostPassword) return current
  hostPassword = next
  publish({ locked: hostPassword !== '', error: '' })
  broadcast(current)
  return current
}

/**
 * 房主把某个人请出房间。
 *
 * 密码能挡住不认识的人，挡不住「密码被转发到群里」之后进来的那几位。已经
 * 进来的人只能请出去——而且请出去之后不能让他自动重连回来，否则一秒钟后
 * 他又在房间里，看起来像是请人这个按钮坏了。
 *
 * 客人调用无效果：一个客人能踢别人，这间房就没法待了。
 */
export function kickMember(id: string): PartyState {
  if (current.role !== 'host' || !id || id === 'host') return current
  for (const [socket, peer] of peers) {
    if (peer.id !== id) continue
    try {
      socket.send(JSON.stringify({ t: 'kicked', reason: '房主把你请出了房间' }))
    } catch {
      /* 已经断了 */
    }
    try {
      socket.close()
    } catch {
      /* 已经断了 */
    }
    peers.delete(socket)
    break
  }
  publish({ members: membersNow() })
  broadcast(current)
  return current
}

/** 房主开关转发。客人调用无效果。 */
export function setRelay(value: boolean): void {
  if (current.role !== 'host' || current.relay === value) return
  publish({ relay: value })
  broadcast(current)
}

/**
 * 两串队列是不是同一份。
 *
 * 只比 id 序列：标题、封面这些是曲目自己的属性，id 一样就不会变；逐字段比
 * 反而会因为某次接口补了封面就整条重推一遍。
 */
function sameQueue(a: PartyQueueItem[], b: PartyQueueItem[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false
  }
  return true
}

/**
 * 房主把房间的播放队列定下来。
 *
 * 只在房主这边有效：客人是镜像方，它调这个不会改到别人的房间（与改名、
 * 上锁那些房主专属命令一致）。队列没变就不发——房间状态是整包广播的，
 * 一次多余的推送等于给每个成员多发一份队列。
 */
export function setQueue(queue: PartyQueueItem[]): void {
  if (current.role !== 'host') return
  if (sameQueue(current.queue, queue)) return
  publish({ queue, rev: stampRev() })
  broadcast(current)
}

/**
 * 一串文本能进房间状态的最大长度。
 *
 * 房间里谁都能下命令（这是有意的），所以每个字段都得截：不截的话，一个把
 * 歌名塞成两万字的客户端能让所有人的面板同时跳一下，而它自己看起来很正常。
 */
function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? [...value].slice(0, max).join('') : ''
}

/** 队列里的一首：字段一个一个过，形状不对就当没这一条。 */
function cleanQueueItem(raw: unknown): PartyQueueItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<PartyQueueItem>
  const id = clip(item.id, 160)
  if (!id) return null
  const duration = Number(item.duration)
  return {
    id,
    source: clip(item.source, 24) || 'local',
    title: clip(item.title, 120),
    artist: clip(item.artist, 120),
    album: clip(item.album, 120),
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
    coverUrl: typeof item.coverUrl === 'string' ? clip(item.coverUrl, 512) : null,
    hasArt: item.hasArt === true
  }
}

/** 房主那份流：地址与音质都截一下，`via` 只认这两个值。 */
function cleanStream(raw: PartyNow['stream']): PartyNow['stream'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const url = clip(raw.url, 2048)
  if (!url) return undefined
  return {
    url,
    quality: clip(raw.quality, 16),
    via: raw.via === 'relay' ? 'relay' : 'direct'
  }
}

/**
 * 一条「在听什么」的清洗。
 *
 * `seq` 不在这里给：它只由 `publishNow` 盖章。客户端带什么号都会被丢掉——
 * 号是房主这一侧的记账，不是发言人的特权。
 */
function cleanNow(raw: PartyNow): PartyNow {
  const track = raw.track ? cleanQueueItem(raw.track) : null
  const stream = cleanStream(raw.stream)
  const position = Number(raw.position)
  const at = Number(raw.at)
  return {
    trackId: clip(raw.trackId, 160),
    title: clip(raw.title, 160),
    artist: clip(raw.artist, 160),
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
    position: Number.isFinite(position) && position > 0 ? position : 0,
    playing: raw.playing === true,
    ...(raw.why === 'track' || raw.why === 'state' || raw.why === 'seek' || raw.why === 'tick'
      ? { why: raw.why }
      : {}),
    ...(track ? { track } : {}),
    ...(stream ? { stream } : {})
  }
}

/** 位置差这么多秒以内，就算「不是一次新的拖动」。 */
const REPEAT_POSITION_EPS_S = 1.5

/** 房间此刻应该在第几秒：`now` 自己会随播放往前推。 */
function livePosition(now: PartyNow, at = Date.now()): number {
  if (!now.playing) return now.position
  return now.position + Math.max(0, (at - now.at) / 1000)
}

/**
 * 这条命令是不是「房间已经是这样了」。
 *
 * 这是断掉回声的第一道闸，也是最重要的一道。一个人按暂停，房里其他人跟着被
 * 暂停——他们的客户端会看到一次「本地状态变了」，如果照报，房主就会收到一串
 * 「暂停」；每条都盖新号再推回去，播放键就开始自己跳。这里按命令的类别比：
 * 起停只看 `playing`，切歌只看曲目，拖动看位置差。等价就不算变化。
 */
function redundant(why: string, now: PartyNow): boolean {
  const prev = current.now
  if (!prev) return false
  if (prev.trackId !== now.trackId) return false
  if (why === 'state') return prev.playing === now.playing
  if (why === 'track' || why === 'seek') {
    return Math.abs(livePosition(prev) - now.position) <= REPEAT_POSITION_EPS_S
  }
  return false
}

/**
 * 应用一条「在听什么」，然后广播。
 *
 * 房主本地的操作与成员发来的命令都走这一条：房间里只有这一处给状态盖章，
 * 谁先按、谁后按最终都由这里排号——不是各端自己说了算。等价命令在这里被
 * 吸收掉，连号都不盖：它没有改变任何东西，广播出去只会让别人的 watcher
 * 再动一次。
 */
function publishNow(raw: PartyNow): void {
  const now = cleanNow(raw)
  const why = now.why
  if (why && why !== 'tick' && redundant(why, now)) return
  publish({ now: { ...now, seq: stampRev() }, rev: roomRev })
  broadcast(current)
}

/** 把队列里的一首提上来放：先从队列拿走，再作为「现在」广播。 */
function playQueueEntry(id: string): void {
  if (current.role !== 'host') return
  const item = current.queue.find((each) => each.id === id)
  if (!item) return
  publish({ queue: removeFromQueue(current.queue, id) })
  publishNow({
    trackId: item.id,
    title: item.title,
    artist: item.artist,
    at: Date.now(),
    position: 0,
    playing: true,
    why: 'track',
    track: { ...item }
  })
}

/**
 * 队列命令的唯一入口。
 *
 * `add` / `remove` / `move` / `play` / `clear` 都在这儿落地。没有「谁的歌
 * 才能删」这一说：房间列表是大家共用的，谁都能整理；不设权限是因为一起听本来
 * 就是熟人之间的小房间，管得太细只会让「想换一首」变成要去找房主。
 */
function applyQueueCommand(op: string, data: Record<string, unknown>): void {
  if (current.role !== 'host') return
  const id = typeof data.id === 'string' ? data.id : ''
  if (op === 'add') {
    const item = cleanQueueItem(data.item)
    if (!item) return
    const next = addToQueue(current.queue, item)
    if (next === current.queue) return
    publish({ queue: next, rev: stampRev() })
    broadcast(current)
    return
  }
  if (op === 'remove') {
    const next = removeFromQueue(current.queue, id)
    if (next === current.queue) return
    publish({ queue: next, rev: stampRev() })
    broadcast(current)
    return
  }
  if (op === 'move') {
    const next = moveInQueue(current.queue, id, Number(data.to))
    if (next === current.queue) return
    publish({ queue: next, rev: stampRev() })
    broadcast(current)
    return
  }
  if (op === 'clear') {
    if (current.queue.length === 0) return
    publish({ queue: [], rev: stampRev() })
    broadcast(current)
    return
  }
  if (op === 'play') playQueueEntry(id)
}

/** 房主本地直接应用；客人把命令交给房主，等它广播回来才生效。 */
function queueCommand(payload: Record<string, unknown>): void {
  if (current.role === 'guest') {
    if (guestSocket?.readyState === WebSocket.OPEN) {
      guestSocket.send(JSON.stringify(payload))
    }
    return
  }
  if (current.role !== 'host') return
  applyQueueCommand(String(payload.op ?? ''), payload)
}

export function addQueueItem(item: PartyQueueItem): void {
  queueCommand({ t: 'queue', op: 'add', item })
}

export function removeQueueItem(id: string): void {
  queueCommand({ t: 'queue', op: 'remove', id })
}

export function moveQueueItem(id: string, to: number): void {
  queueCommand({ t: 'queue', op: 'move', id, to })
}

export function playQueueItem(id: string): void {
  queueCommand({ t: 'queue', op: 'play', id })
}

export function clearRoomQueue(): void {
  queueCommand({ t: 'queue', op: 'clear' })
}

export function pushNow(now: PartyNow): void {
  /*
   * 客人先上报给房主，不当场改自己的状态。
   *
   * 房间状态只有一份，在房主那台机器上；这边改完立刻生效的话，房主的旧状态
   * 下一个心跳就会把它顶回去，界面上就是「点了下一首、一秒后又跳回来」。
   * 所以客人这一步只是把「我想听这首」发过去，真正落定与广播由房主做。
   */
  if (current.role === 'guest') {
    if (guestSocket?.readyState === WebSocket.OPEN) {
      guestSocket.send(JSON.stringify({ t: 'now', now }))
    }
    return
  }
  if (current.role !== 'host') return
  publishNow(now)
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
export function joinParty(url: string, code: string, name: string, pass = ''): PartyState {
  stopParty()
  const trimmed = url.trim()
  if (!trimmed) {
    publish({ error: '先填房主的地址' })
    return current
  }
  const wanted = cleanCode(code)
  const target = /^wss?:\/\//.test(trimmed) ? trimmed : 'ws://' + trimmed
  const socket = new WebSocket(target)
  guestSocket = socket
  /*
   * 界面上那一行照原样显示，协议不剥。
   *
   * 以前剥掉 wss:// 是因为它「对判断连没连上没有帮助」；现在 Cloudflare 隧道
   * 走的就是 wss://，剥掉之后客人看到的是一条没有协议的域名，出问题时也分不清
   * 自己走的是哪条路。这里只去掉尾部斜杠。
   */
  const shown = trimmed.replace(/\/+$/, '')
  publish({ role: 'guest', address: shown, code: wanted, connecting: true, error: '', refused: '' })

  /*
   * 一次加入只有两种结局：房主回了状态，或者没有。
   *
   * 以前三种失败（码不对、连不上、房主不回话）都只往 error 里写一句话，role
   * 还停在 guest——界面上就是「进了一个没有人的房间」，退回去再进来还是它。
   * 现在失败一律回到 idle，把原因留在入口页。空房间只该出现在真的没人的时候。
   */
  let failed = false
  let waitTimer: ReturnType<typeof setTimeout> | null = null
  const fail = (reason: string): void => {
    if (failed) return
    failed = true
    if (waitTimer) clearTimeout(waitTimer)
    waitTimer = null
    guestSocket = null
    try {
      socket.close()
    } catch {
      /* 已经断了 */
    }
    publish({ ...idle(), error: reason, refused: reason })
  }

  /*
   * 握上手却迟迟没有一份状态——多半是两边版本对不上，或者房主那边卡住了。
   *
   * 等六秒给一句能照做的话，比一直转圈有用：用户至少知道该去核对版本或让
   * 房主重开，而不是对着一个空的房间页猜。
   */
  waitTimer = setTimeout(() => {
    fail('连上了，但房主没有回话：确认两台版本一致，或者让房主重开一次房间')
  }, 6000)

  socket.on('open', () => {
    socket.send(
      JSON.stringify({ t: 'hello', id: partyIdentity(), code: wanted, name, pass: pass.trim() })
    )
  })

  socket.on('message', (raw) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.t === 'refused') {
      fail(String(message.reason ?? '房主拒绝了这次加入'))
      return
    }
    /* 被请出去和「码不对」一样是终局：回入口、不再自动重连。 */
    if (message.t === 'kicked') {
      fail(String(message.reason ?? '房主把你请出了房间'))
      return
    }
    if (message.t === 'state' && message.state && typeof message.state === 'object') {
      if (waitTimer) clearTimeout(waitTimer)
      waitTimer = null
      const incoming = message.state as unknown as PartyState
      publish({ ...incoming, role: 'guest', address: shown, connecting: false, error: '', refused: '' })
    }
  })

  /*
   * 握手上不去的另一种样子：对面回了 HTTP 错误页。
   *
   * 樱花这类端口映射在隧道没开、或者隧道是 HTTP 类型（节点对未备案域名回
   * 503 / 501）时，WS 升级请求根本到不了房间。以前这种情况统一报「连不上
   * 房主」，把「地址写错」「隧道没开」「隧道类型不对」混成一句——用户拿着
   * 邀请链接只会反复重试。这里把对面包的 HTTP 状态原样说出来。
   */
  socket.on('unexpected-response', (_request, response) => {
    const status = response.statusCode ?? 0
    fail(
      `连到了 ${shown}，但对面回的是 HTTP ${status}：这个地址不是一起听房间。` +
        '走樱花隧道的话，确认隧道在线，并且类型是 TCP（HTTP 隧道会被节点按域名备案拦掉）'
    )
  })

  socket.on('error', () => {
    // 公网场景下「是否在同一网络」是句错话：地址、房间码、隧道任一处不对都连不上。
    fail('连不上房主：检查地址与房间码，房主那边如果走的是公网，还要确认隧道开着')
  })

  socket.on('close', () => {
    /* 已经按失败收过尾的那一次，close 只是它的回声，不该再把原因改成「房间已关闭」。 */
    if (failed) return
    if (waitTimer) clearTimeout(waitTimer)
    waitTimer = null
    if (current.role === 'guest') {
      guestSocket = null
      publish({ ...idle(), error: '房间已关闭：房主结束了这一趟，或者他那边断网、隧道断了' })
    }
  })

  return current
}
