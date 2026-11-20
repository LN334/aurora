import { createConnection } from 'node:net'
import { session } from 'electron'
import { LOCAL_PROXY_PORTS, proxyRulesFor } from '../pure/proxy'
import { write } from '../startup-log'
/**
 * 樱花隧道列表。
 *
 * 启动器把隧道画成一列卡片（ID / 节点 / 映射 / 开关），数据不在本机——启动器的
 * user.config 里只有界面偏好。所以这里照它的做法直接问接口：`/v4/tunnels`
 * 用访问密钥换列表。api.natfrp.com 国内可直连，不需要代理。
 *
 * 字段名按官方启动器的卡片能显示的项来取：ID、名字、节点、协议、本地端口、
 * 公网端口、在线状态。接口给的名字与这里不一定一一对应，所以每个字段都做兜底，
 * 拿不到就留空——宁可显示少一点，也不要把 undefined 印到界面上。
 */

interface SakuraTunnel {
  id: number
  name: string
  node: string
  type: string
  localPort: number
  remotePort: number
  online: boolean
}

interface SakuraTunnelsResult {
  ok: boolean
  message: string
  tunnels: SakuraTunnel[]
  /** 原始响应片段：字段猜错时靠它定位，不藏在日志里。 */
  raw: string
}

const BASE = 'https://api.natfrp.com/v4'

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function toNumber(value: unknown): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function mapTunnel(value: unknown): SakuraTunnel | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const id = toNumber(pick(record, ['id', 'tunnel_id', 'tunnelId']))
  if (!id) return null
  return {
    id,
    name: String(pick(record, ['name', 'tunnel_name', 'remark']) ?? ''),
    /* 真实响应里 node 是节点 id（数字），不是节点名。 */
    node: String(pick(record, ['node_name', 'nodeName', 'server', 'node']) ?? ''),
    type: String(pick(record, ['type', 'protocol']) ?? 'tcp').toLowerCase(),
    localPort: toNumber(pick(record, ['local_port', 'localPort', 'local'])),
    remotePort: toNumber(pick(record, ['remote_port', 'remotePort', 'remote'])),
    online: Boolean(pick(record, ['online', 'is_online', 'running']))
  }
}

/**
 * 找一个能通的路去问樱花接口。
 *
 * api.natfrp.com 在这台机器上直连时通时不通（实测连着四次 000），走本地代理才稳。
 * 但别人不一定挂着代理，所以顺序是「先直连、再逐个本地代理端口试」，谁先给出
 * 响应就用谁；全都不通才报连不上。
 */
/**
 * 给一个请求加死线。
 *
 * AbortSignal.timeout 在 Electron 的 session.fetch 上没能把请求拉回来（实测十四秒
 * 都没返回），所以改成自己 race：到点就判失败，请求在后台自生自灭。
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' 超时 ' + ms + 'ms')), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** 这个端口上有没有东西在听：几十毫秒就能有答案，比等满超时便宜得多。 */
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

async function fetchWithRoute(url: string, init: RequestInit): Promise<Response> {
  /*
   * 直连先试，但走 Chromium 的网络栈（session.fetch）而不是 Node 的 fetch。
   *
   * Node 的 fetch 在这台机器上碰到这个域名会一直挂着，AbortSignal 也没能把它拉
   * 回来（实测十四秒都没返回）。session.fetch 的超时是可靠的。
   */
  try {
    const direct = await withTimeout(session.defaultSession.fetch(url, init), 5000, '直连')
    return direct
  } catch (error) {
  }
  /*
   * 只对「确实有东西在听」的端口试代理。
   *
   * 之前十五个端口挨个试，每一个都要等满才失败，一次刷新能拖三十多秒——界面
   * 一直停在「正在拉取」。先花几十毫秒探一下端口开着没，只试开着的。
   */
  const order = [7890, 7891, ...LOCAL_PROXY_PORTS.filter((port) => port !== 7890 && port !== 7891)]
  for (const port of order) {
    if (!(await portOpen(port))) continue
    try {
      const route = session.fromPartition('sakura-api-' + port)
      /* 格式要对：Electron 要的是 http=host:port;https=host:port，不是 URL。 */
      await route.setProxy({ proxyRules: proxyRulesFor({ host: '127.0.0.1', port }) })
      const viaProxy = await withTimeout(route.fetch(url, init), 6000, '代理 ' + port)
      return viaProxy
    } catch (error) {
    }
  }
  write('sakura: 直连与本地代理都不通')
  throw new Error('直连与本地代理都不通')
}

export async function sakuraTunnels(token: string): Promise<SakuraTunnelsResult> {
  if (!token.trim()) return { ok: false, message: '还没有访问密钥', tunnels: [], raw: '' }
  try {
    const response = await fetchWithRoute(BASE + '/tunnels', {
      headers: {
        Authorization: 'Bearer ' + token.trim(),
        Accept: 'application/json'
      }
    })
    const text = await response.text()
    /*
     * 两种成功形状都要认：
     *   /tunnels 直接回一个数组；
     *   出错时回 { code, msg }（例如 code 401 访问密钥无效）。
     * 之前只按 {code,data} 解析，于是正常响应被当成失败，列表永远是空的。
     */
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      /* 不是 JSON：把原文留作证据 */
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const envelope = parsed as { code?: number; msg?: string; data?: unknown }
      if (typeof envelope.code === 'number' && envelope.code !== 0) {
        return {
          ok: false,
          message: envelope.msg ?? '接口回了 HTTP ' + response.status,
          tunnels: [],
          raw: text.slice(0, 400)
        }
      }
    }
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { data?: unknown })?.data)
        ? ((parsed as { data: unknown[] }).data)
        : []
    return {
      ok: true,
      message: '',
      tunnels: list.map(mapTunnel).filter((item): item is SakuraTunnel => item !== null),
      raw: text.slice(0, 400)
    }
  } catch (error) {
    return {
      ok: false,
      message: '连不上樱花接口：' + (error instanceof Error ? error.message : String(error)),
      tunnels: [],
      raw: ''
    }
  }
}
