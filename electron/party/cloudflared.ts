import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { TunnelState } from './tunnel.ts'
import { parseCloudflareLine } from '../pure/cloudflare-url.ts'
import { partyState } from './room.ts'

/**
 * Cloudflare 快速隧道：一起听的第二条公网通道。
 *
 * 樱花免费节点对「直接用节点域名访问」一律回 503 / 501（域名没备案），一起听
 * 要的是一条能跑 WebSocket 的通路，正好被那一层挡住。
 *
 * cloudflared 的快速隧道不要账号、不要备案、不花钱：把 127.0.0.1:房间端口 挂到
 * https://<随机名>.trycloudflare.com，WebSocket 能穿过去（实测能收到房间自己的
 * 「房间码不对」回复，说明请求真的到了 Aurora）。
 *
 * 代价是地址随机、进程重启就变。所以要固定地址得走具名隧道（先
 * `cloudflared tunnel login` 授权一次），那是另一件事。
 */

const CANDIDATES = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  join(process.env.LOCALAPPDATA ?? '', 'cloudflared', 'cloudflared.exe')
]

/** 找一份可用的 cloudflared。找不到不是错误，界面上说一句就够。 */
function findCloudflared(): string | null {
  for (const path of CANDIDATES) {
    if (path && existsSync(path)) return path
  }
  return null
}

const EMPTY: TunnelState = { running: false, address: '', line: '', error: '', log: [] }
const LOG_LIMIT = 300

let child: ChildProcess | null = null
let state: TunnelState = { ...EMPTY }
let generation = 0
const listeners = new Set<(next: TunnelState) => void>()

function publish(patch: Partial<TunnelState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) {
    try {
      listener(state)
    } catch {
      /* 一个订阅者坏了不该耽误其余界面。 */
    }
  }
}

export function onCloudflareState(listener: (next: TunnelState) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function cloudflareState(): TunnelState {
  return state
}

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

/** 房间现在监听的本机端口；房间没开时返回 0。 */
function roomPort(): number {
  const address = partyState().address
  const at = address.lastIndexOf(':')
  if (at < 0) return 0
  const port = Number(address.slice(at + 1))
  return Number.isInteger(port) && port > 0 ? port : 0
}

export async function startCloudflared(port?: number): Promise<TunnelState> {
  stopCloudflared()
  const exe = findCloudflared()
  if (!exe) {
    publish({ ...EMPTY, error: '没找到 cloudflared.exe：装一份 Cloudflare 客户端，或者把它放到 C:\\Program Files (x86)\\cloudflared\\' })
    return state
  }
  const local = port && port > 0 ? port : roomPort()
  if (!local) {
    publish({ ...EMPTY, error: '先在 Aurora 里开一个房间，隧道要指向房间端口' })
    return state
  }
  if (!(await portOpen(local))) {
    publish({ ...EMPTY, error: '房间端口 ' + local + ' 没有在听：先开房间再启动隧道' })
    return state
  }

  const mine = ++generation
  publish({ ...EMPTY, running: true, line: '正在建立隧道…' })
  const proc = spawn(exe, ['tunnel', '--url', 'http://127.0.0.1:' + local, '--no-autoupdate'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child = proc

  const onLine = (raw: string): void => {
    if (generation !== mine) return
    const text = raw.replace(/\s+$/, '')
    if (!text) return
    const next = [...state.log, text].slice(-LOG_LIMIT)
    const address = parseCloudflareLine(text)
    const patch: Partial<TunnelState> = { log: next, line: text.slice(0, 160) }
    if (address && state.address !== address) {
      patch.address = address
      patch.line = '隧道已通：' + address
    }
    publish(patch)
  }

  let buffer = ''
  const feed = (chunk: Buffer): void => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  }
  proc.stdout?.on('data', feed)
  proc.stderr?.on('data', feed)

  proc.on('error', (error) => {
    if (generation !== mine) return
    publish({ error: '启动 cloudflared 失败：' + error.message, running: false })
    child = null
  })

  proc.on('exit', (code) => {
    if (generation !== mine) return
    child = null
    /*
     * 退出原因要翻成人话。
     *
     * cloudflared 申请不到快速隧道时只留一行 `failed to request quick Tunnel`
     * 之类的英文，把它原样甩给用户，等于让人去读 Cloudflare 的英文文档。
     * 这个失败几乎只有一个原因：这台机器出不去（代理的全局/TUN 模式、公司网络）。
     */
    const tail = state.log.slice(-12).join(' ')
    let reason = state.address
      ? '隧道已断开（cloudflared 退出，代码 ' + code + '）'
      : 'cloudflared 没起来（退出代码 ' + code + '），日志里有原因'
    if (!state.address && /failed to request quick Tunnel|request failed|no free tunnels|context deadline exceeded/i.test(tail)) {
      reason = '向 Cloudflare 申请隧道失败：多半是这台机器出不去，开一下代理再点启动' 
    }
    publish({ running: false, error: reason })
  })

  return state
}

export function stopCloudflared(): void {
  generation += 1
  if (child) {
    try {
      child.kill()
    } catch {
      /* 已经退了 */
    }
    child = null
  }
  /* 日志留着：手动停下来之后，上一次为什么没通往往就在那几十行里。 */
  if (state.running || state.address || state.error) {
    publish({ ...EMPTY, log: state.log.slice(-LOG_LIMIT) })
  }
}
