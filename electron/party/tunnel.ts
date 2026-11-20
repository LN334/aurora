import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import type { ChildProcess } from 'node:child_process'

/**
 * 樱花内网穿透的隧道进程。
 *
 * 用官方**独立分发版** frpc（面板「软件下载」里那个），启动方式是官方的
 * `frpc -f <访问密钥>:<隧道ID>`。不要用启动器安装目录里那份：它被改成只允许
 * SakuraFrp Service 调用，裸跑只会打印一行声明就退出（实测两次，带 -f 也一样）。
 *
 * 这一层只做四件事：起进程、把它的输出翻译成状态、直连失败时换本地代理再来一次、
 * 停掉。地址与错误都从输出里认，不依赖固件的具体文案格式——樱花版 frp 的日志
 * 措辞换过几次。
 *
 * 为什么要有「换代理」这一步：这台机器上直连节点 7000 端口能连上，但登录握手
 * 会被掐断（日志里就是一句 EOF），走本地代理立刻就通。真实用户的网络什么样都
 * 可能，自动试一次比让他盯着「网络连接失败」自己猜要好。
 */

interface TunnelConfig {
  /** frpc.exe 的绝对路径。 */
  frpcPath: string
  /** 访问密钥（面板里那个）。 */
  token: string
  /** 隧道 ID，多个用逗号分隔。 */
  tunnelId: string
}

export interface TunnelState {
  running: boolean
  /** 已经拿到的公网地址（`host:端口`），没有就是空串。 */
  address: string
  /** 最近一行值得给人看的输出。 */
  line: string
  error: string
  /**
   * 最近的原始日志（最多 `LOG_LIMIT` 行）。
   *
   * frpc 的话是排查的唯一凭据：界面上那只显示一行，是因为一行就够告诉人
   * 「在动」；真出问题时得看前一分钟发生了什么，所以整段留着。
   */
  log: string[]
}

const EMPTY: TunnelState = { running: false, address: '', line: '', error: '', log: [] }

/** 日志留多少行：够看清一次失败的前因后果，又不至于让推送变成大包。 */
const LOG_LIMIT = 300

/** 本地代理常在这几个端口上；与 electron/pure/proxy.ts 那份保持一致的顺序。 */
const PROXY_PORTS = [7890, 7891, 7892, 7897, 10808, 10809, 1080, 1087, 2080, 33210, 8888, 8889, 8080, 6152, 20171]

let child: ChildProcess | null = null
let state: TunnelState = { ...EMPTY }
let config: TunnelConfig | null = null
/* 每条进程一个号：换代理时要杀掉旧的再起新的，旧进程的 exit 回调不能改新状态。 */
let generation = 0
let triedProxy = false
const listeners = new Set<(next: TunnelState) => void>()

function publish(patch: Partial<TunnelState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) {
    try {
      listener(state)
    } catch {
      // 一个订阅者坏了不该耽误其余界面。
    }
  }
}

export function onTunnelState(listener: (next: TunnelState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function tunnelState(): TunnelState {
  return state
}

/**
 * 公网地址长这样：`xxx.natfrp.cloud:12345`、`frp-run.com:23720`（节点域名随节点变，
 * 所以只认已知后缀 + `:端口` 的形状）。实测这台机器拿到的就是 frp-run.com 这一种。
 */
const ADDRESS_PATTERN =
  /(?:^|[^a-z0-9.-])((?:[a-z0-9-]+[.])*(?:natfrp[.](?:cloud|com|net)|frp-run[.]com|frp-act[.]com|frp[.]run)):([0-9]{2,5})(?![0-9])/i

/**
 * 从一行输出里认出「拿到地址了」或「出错了」。
 *
 * 抽成纯函数是为了能单测：frpc 的真实日志没法在 CI 里跑出来，但它的样子
 * 可以按文档与实测样本固定下来。
 */
export function parseTunnelLine(line: string): { kind: 'address'; address: string } | { kind: 'error'; message: string } | null {
  const match = ADDRESS_PATTERN.exec(line)
  if (match) return { kind: 'address', address: match[1] + ':' + match[2] }
  /*
   * 节点登录被掐断：日志里会拖一串说明和一个 doc 链接，直接给人看只会让人去
   * 读一页英文 FAQ。这里翻成一句能自己动手的话。
   */
  /*
   * 节点挑 IP：走代理时出口在国外，节点会直接拒绝（日志里是 [-3]）。
   * 这不是网络故障，关掉代理的全局/TUN 模式就能通，说清楚。
   */
  if (/只允许中国内地|不符合要求|\[-3\]/.test(line)) {
    return { kind: 'error', message: '这个节点只接受大陆网络：把代理的全局/TUN 模式关掉，或者换一个节点再试' }
  }
  if (/登录节点失败|login to server failed/i.test(line)) {
    return {
      kind: 'error',
      message: '登录没成：先关掉樱花启动器（同一条隧道只能一个客户端登录），或换代理 / 换网络再试'
    }
  }
  if (/(?:^|[^a-z])(?:error|failed)(?:[^a-z]|$)|失败|错误/i.test(line)) {
    return { kind: 'error', message: line.replace(/^\[[^\]]*\]\s*/, '').slice(0, 200) }
  }
  return null
}

/** 这个端口上有没有东西在听：几十毫秒就有答案，比等满超时便宜得多。 */
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const done = (open: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(400)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * 直连登录失败时，换本地代理重来一次。
 *
 * 只试一次：代理也不通就该停下来说清楚，而不是在几个端口之间来回倒腾。
 */
async function retryViaProxy(): Promise<void> {
  if (triedProxy || !config) return
  triedProxy = true
  let port = 0
  for (const candidate of PROXY_PORTS) {
    if (await portOpen(candidate)) {
      port = candidate
      break
    }
  }
  if (!port) {
    publish({ error: '连不上樱花节点：换个网络，或者先开代理再试' })
    return
  }
  const marked = [...state.log, '—— 直连没通，改走本地代理 127.0.0.1:' + port + ' ——']
  publish({ log: marked.slice(-LOG_LIMIT), line: '直连节点没通，改走本地代理 127.0.0.1:' + port, error: '' })
  const previous = child
  child = null
  generation += 1
  try {
    previous?.kill()
  } catch {
    // 已经没了。
  }
  spawnFrpc('http://127.0.0.1:' + port)
}

function spawnFrpc(proxy?: string): void {
  const snapshot = config
  if (!snapshot) return
  const args = ['-f', snapshot.token + ':' + snapshot.tunnelId]
  if (proxy) args.push('--proxy', proxy)
  const id = ++generation
  let proc: ChildProcess
  try {
    proc = spawn(snapshot.frpcPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    publish({ running: false, error: '启动 frpc 失败：' + (error instanceof Error ? error.message : String(error)) })
    return
  }

  const eat = (chunk: Buffer): void => {
    const text = chunk.toString('utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      if (id !== generation) return
      const log = state.log.length >= LOG_LIMIT ? [...state.log.slice(1), line.slice(0, 400)] : [...state.log, line.slice(0, 400)]
      publish({ log, line: line.slice(0, 200) })
      const parsed = parseTunnelLine(line)
      if (parsed?.kind === 'address') publish({ address: parsed.address })
      else if (parsed?.kind === 'error') {
        publish({ error: parsed.message })
        if (/登录节点失败|login to server failed/i.test(line)) void retryViaProxy()
      }
    }
  }
  child = proc
  proc.stdout?.on('data', eat)
  proc.stderr?.on('data', eat)
  proc.on('error', (error) => {
    if (id !== generation) return
    child = null
    publish({ running: false, error: 'frpc 起不来：' + error.message })
  })
  proc.on('exit', (code) => {
    /* 换代理时这条已经作废：它的退出不该把新进程的状态写成「已停」。 */
    if (id !== generation) return
    child = null
    const why = code
      ? 'frpc 退出了（' + code + '）'
      : 'frpc 自己退出了：可能是另一个客户端（比如樱花启动器）登录了同一条隧道'
    publish({ running: false, error: state.error || why })
  })
}

export function startTunnel(input: TunnelConfig): TunnelState {
  stopTunnel()
  config = input
  triedProxy = false
  if (!input.frpcPath || !input.token || !input.tunnelId) {
    publish({ error: '先装好 frpc，再填访问密钥与隧道 ID' })
    return state
  }

  publish({ running: true, address: '', line: '', error: '', log: [...state.log, '—— 启动隧道 ——'] })
  spawnFrpc()
  return state
}

export function stopTunnel(): void {
  generation += 1
  const running = child
  child = null
  config = null
  if (!running) {
    if (state.running || state.address) publish({ running: false, address: '', line: '', error: '' })
    return
  }
  try {
    running.kill()
  } catch {
    // 已经没了。
  }
  /* 日志不清：断开之后「为什么断的」比「现在停了」更值得留下。 */
  publish({ running: false, address: '', line: '', error: '' })
}

/** 清空日志面板。只动这一份展示用的缓冲，不影响隧道本身。 */
export function clearTunnelLog(): void {
  publish({ log: [] })
}
