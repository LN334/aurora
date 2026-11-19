import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

/**
 * 樱花内网穿透的隧道进程。
 *
 * 用官方**独立分发版** frpc（面板「软件下载」里那个），启动方式是官方的
 * `frpc -f <访问密钥>:<隧道ID>`。不要用启动器安装目录里那份：它被改成只允许
 * SakuraFrp Service 调用，裸跑只会打印一行声明就退出（实测两次，带 -f 也一样）。
 *
 * 这一层只做三件事：起进程、把它的输出翻译成状态、停掉。地址与错误都从输出里
 * 认，不依赖固件的具体文案格式——樱花版 frp 的日志措辞换过几次。
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
}

const EMPTY: TunnelState = { running: false, address: '', line: '', error: '' }

let child: ChildProcess | null = null
let state: TunnelState = { ...EMPTY }
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

/** 公网地址长这样：`xxx.natfrp.cloud:12345`（节点域名随节点变，所以只认 `host:端口` 的形状）。 */
const ADDRESS_PATTERN = /(?:^|[^a-z0-9-])([a-z0-9-]+(?:[.][a-z0-9-]+)*[.](?:natfrp[.](?:cloud|com|net)|frp[.](?:run))):([0-9]{2,5})(?![0-9])/i

/**
 * 从一行输出里认出「拿到地址了」或「出错了」。
 *
 * 抽成纯函数是为了能单测：frpc 的真实日志没法在 CI 里跑出来，但它的样子
 * 可以按文档与实测样本固定下来。
 */
export function parseTunnelLine(line: string): { kind: 'address'; address: string } | { kind: 'error'; message: string } | null {
  const match = ADDRESS_PATTERN.exec(line)
  if (match) return { kind: 'address', address: match[1] + ':' + match[2] }
  if (/(?:^|[^a-z])(?:error|failed)(?:[^a-z]|$)|失败|错误/i.test(line)) {
    return { kind: 'error', message: line.replace(/^\[[^\]]*\]\s*/, '').slice(0, 200) }
  }
  return null
}

export function startTunnel(config: TunnelConfig): TunnelState {
  stopTunnel()
  if (!config.frpcPath || !config.token || !config.tunnelId) {
    publish({ error: '先填 frpc 路径、访问密钥与隧道 ID' })
    return state
  }

  publish({ running: true, address: '', line: '', error: '' })
  try {
    child = spawn(config.frpcPath, ['-f', config.token + ':' + config.tunnelId], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    publish({ running: false, error: '启动 frpc 失败：' + (error instanceof Error ? error.message : String(error)) })
    return state
  }

  const eat = (chunk: Buffer): void => {
    const text = chunk.toString('utf8')
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line) continue
      publish({ line: line.slice(0, 200) })
      const parsed = parseTunnelLine(line)
      if (parsed?.kind === 'address') publish({ address: parsed.address })
      else if (parsed?.kind === 'error') publish({ error: parsed.message })
    }
  }
  child.stdout?.on('data', eat)
  child.stderr?.on('data', eat)
  child.on('error', (error) => {
    publish({ running: false, error: 'frpc 起不来：' + error.message })
    child = null
  })
  child.on('exit', (code) => {
    child = null
    publish({ running: false, error: state.error || (code ? 'frpc 退出了（' + code + '）' : '') })
  })
  return state
}

export function stopTunnel(): void {
  if (!child) {
    if (state.running || state.address) publish({ ...EMPTY })
    return
  }
  const running = child
  child = null
  try {
    running.kill()
  } catch {
    // 已经没了。
  }
  publish({ ...EMPTY })
}
