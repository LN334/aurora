import { net } from 'electron'
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
  /** 面板上给这条隧道起的备注；没有就是空串。 */
  note: string
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
    note: String(pick(record, ['note', 'description']) ?? ''),
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
 * 把底层网络错误翻成人话。
 *
 * 用户看到 `ENOTFOUND` 或 `net::ERR_NAME_NOT_RESOLVED` 没有任何帮助；这台机器上
 * 最常见的就是 DNS 与代理两件事，所以按这两类给出具体下一步。
 */
export function explainNetwork(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()
  if (lower.includes('enotfound') || lower.includes('err_name_not_resolved') || lower.includes('name resolution')) {
    return '域名解析不了（DNS 不通）：检查网络，或者让代理软件开着'
  }
  if (lower.includes('econnrefused')) return '代理端口没开：代理软件可能没启动'
  if (lower.includes('err_proxy_connection_failed')) return '连不上代理：端口换了或代理退出了'
  if (lower.includes('timeout') || lower.includes('超时') || lower.includes('timed out')) {
    return '连接超时：网络或代理没有通'
  }
  return raw
}

/**
 * 用 Electron 的 net.request 发一次请求。
 *
 * session.fetch 在这台机器上会挂住（curl 走同一个代理是 200，Electron 里却十几秒
 * 没有任何回调），换到这个更底层的实现，超时也在它自己身上做。
 */
function requestText(
  target: string,
  headers: Record<string, string>,
  route: Electron.Session,
  ms: number,
  method = 'GET',
  body?: string
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('超时 ' + ms + 'ms'))), ms)
    try {
      const request = net.request({ url: target, method, session: route, redirect: 'follow' })
      for (const [key, value] of Object.entries(headers)) request.setHeader(key, value)
      request.on('response', (response) => {
        const chunks: string[] = []
        response.on('data', (chunk) => chunks.push(String(chunk)))
        response.on('end', () => finish(() => resolve({ status: response.statusCode, text: chunks.join('') })))
        response.on('error', (error) => finish(() => reject(error)))
      })
      request.on('error', (error) => finish(() => reject(error)))
      if (body !== undefined) request.write(body)
      request.end()
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
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

/**
 * 挑一条能通的路，把响应原样拿回来。
 *
 * 顺序：直连 → 只对「确实有东西在听」的本地端口试代理。每个请求自己带死线，
 * 到点就判失败，绝不让界面停在「正在拉取」上。
 */
/**
 * 只走本机网卡、不跟系统代理的一条路。
 *
 * `session.defaultSession` 会跟随 Windows 的「系统代理」设置：代理软件开着时它
 * 走代理，关掉之后那条设置**常常还留着**（ProxyServer 仍指着 127.0.0.1:7890，
 * 可端口已经没人听了）。这时候 defaultSession 的每个请求都会以
 * ERR_PROXY_CONNECTION_FAILED 失败——我们却把它当成「直连也不通」，于是明明
 * 网是好的，界面照样报「连不上樱花接口」。
 *
 * 所以第一跳必须是显式 direct 的独立会话，这一跳只代表「这台机器自己的网络」。
 */
let directRoute: Electron.Session | null = null

async function directSession(): Promise<Electron.Session> {
  if (!directRoute) {
    directRoute = session.fromPartition('sakura-direct')
    await directRoute.setProxy({ mode: 'direct' })
  }
  return directRoute
}

/**
 * 找一个能通的路去问樱花接口。
 *
 * 顺序：真直连 → 系统代理（开着才试）→ 本地代理端口。
 *
 * 每次先把 DNS 缓存清掉：换网络（校园网 → 热点）之后 Chromium 手里还攥着旧
 * 解析结果，它不知道 Wi-Fi 换了一张网卡——不清就会连着几十秒连不上，看起来
 * 像「时好时坏」。
 */
async function requestWithRoute(
  url: string,
  headers: Record<string, string>,
  method = 'GET',
  body?: string
): Promise<{ status: number; text: string }> {
  const direct = await directSession()
  await direct.clearHostResolverCache().catch(() => {})
  await session.defaultSession.clearHostResolverCache().catch(() => {})

  try {
    return await requestText(url, headers, direct, 6000, method, body)
  } catch {
    /* 真直连不通，再往下试 */
  }

  const resolved = await session.defaultSession.resolveProxy(url).catch(() => 'DIRECT')
  const systemProxy = /PROXY\s+([^\s;]+)/i.exec(resolved)?.[1] ?? ''
  if (systemProxy) {
    try {
      return await requestText(url, headers, session.defaultSession, 7000, method, body)
    } catch {
      /* 系统代理也没通 */
    }
  }

  const order = [7890, 7891, ...LOCAL_PROXY_PORTS.filter((port) => port !== 7890 && port !== 7891)]
  for (const port of order) {
    if (!(await portOpen(port))) continue
    try {
      const route = session.fromPartition('sakura-api-' + port)
      await route.setProxy({ proxyRules: proxyRulesFor({ host: '127.0.0.1', port }) })
      return await requestText(url, headers, route, 7000, method, body)
    } catch {
      /* 这个端口没有代理，或者它也不通 */
    }
  }

  write('sakura: 直连与本地代理都不通 systemProxy=' + (systemProxy || '无'))
  /*
   * 系统代理指向一个没人听的端口时，人最容易误判成「网断了」。这一句直接点出来。
   */
  if (systemProxy) {
    const port = Number(systemProxy.split(':').pop())
    if (port && !(await portOpen(port))) {
      throw new Error('系统代理 ' + systemProxy + ' 连不上：代理软件可能已经退出，关掉系统代理再试')
    }
  }
  throw new Error('直连与本地代理都不通')
}

export async function sakuraTunnels(token: string): Promise<SakuraTunnelsResult> {
  if (!token.trim()) return { ok: false, message: '还没有访问密钥', tunnels: [], raw: '' }
  try {
    const response = await requestWithRoute(BASE + '/tunnels', {
      Authorization: 'Bearer ' + token.trim(),
      Accept: 'application/json'
    })
    const text = response.text
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
      message: '连不上樱花接口：' + explainNetwork(error),
      tunnels: [],
      raw: ''
    }
  }
}

interface SakuraNode {
  id: number
  name: string
  vip: number
  flag: number
  band: string
}

/** 节点列表：建隧道时要选一个。接口回的是 { "2": {...}, "3": {...} } 这种对象。 */
export async function sakuraNodes(token: string): Promise<{ ok: boolean; message: string; nodes: SakuraNode[] }> {
  if (!token.trim()) return { ok: false, message: '还没有访问密钥', nodes: [] }
  try {
    const response = await requestWithRoute(BASE + '/nodes', {
      Authorization: 'Bearer ' + token.trim(),
      Accept: 'application/json'
    })
    let parsed: unknown = null
    try {
      parsed = JSON.parse(response.text)
    } catch {
      return { ok: false, message: '节点接口回了非 JSON（HTTP ' + response.status + '）', nodes: [] }
    }
    if (!parsed || typeof parsed !== 'object') return { ok: false, message: '节点列表是空的', nodes: [] }
    const nodes = Object.entries(parsed as Record<string, Record<string, unknown>>).map(([id, value]) => ({
      id: Number(id),
      name: String(value.name ?? ''),
      vip: Number(value.vip ?? 0),
      flag: Number(value.flag ?? 0),
      band: String(value.band ?? '')
    }))
    return { ok: true, message: '', nodes }
  } catch (error) {
    return {
      ok: false,
      message: '连不上樱花接口：' + explainNetwork(error),
      nodes: []
    }
  }
}

interface SakuraCreateInput {
  name: string
  node: number
  localPort: number
  /** http/https 才要绑定域名；tcp 留空。 */
  remote?: string
  type?: string
}

/**
 * 建一条隧道。
 *
 * POST /v4/tunnels，必填 name / type / node，tcp 还要 local_ip 与 local_port。
 * 官方文档里给 AI 助手那段要求：创建前先确认用途——我们这里是「把房间端口穿到
 * 公网的一档 TCP」，不属于公开游戏服务器，不触发专用节点那条限制。
 */
export async function sakuraCreateTunnel(token: string, input: SakuraCreateInput): Promise<{ ok: boolean; message: string; id: number }> {
  if (!token.trim()) return { ok: false, message: '还没有访问密钥', id: 0 }
  const form = new URLSearchParams({
    name: input.name,
    type: input.type ?? 'tcp',
    node: String(input.node),
    local_ip: '127.0.0.1',
    local_port: String(input.localPort)
  })
  if (input.remote) form.set('remote', input.remote)
  try {
    const response = await requestWithRoute(
      BASE + '/tunnels',
      {
        Authorization: 'Bearer ' + token.trim(),
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      'POST',
      form.toString()
    )
    let parsed: unknown = null
    try {
      parsed = JSON.parse(response.text)
    } catch {
      return { ok: false, message: '接口回了非 JSON（HTTP ' + response.status + '）', id: 0 }
    }
    const body = parsed as { id?: number; name?: string; msg?: string; code?: number }
    if (body && typeof body.id === 'number') return { ok: true, message: '', id: body.id }
    return { ok: false, message: body?.msg ?? '接口没有返回隧道 id（HTTP ' + response.status + '）', id: 0 }
  } catch (error) {
    return { ok: false, message: '连不上樱花接口：' + explainNetwork(error), id: 0 }
  }
}

/**
 * 删一条隧道。
 *
 * 参数名是 `ids`（复数）、值是字符串，不是 `id`，也不是数组——写成别的形状
 * 只会拿回一句「参数错误」；写成数组时服务端直接抛 ClassCastException。实测
 * 出来的形状，别再改。
 */
export async function sakuraDeleteTunnel(token: string, ids: string): Promise<{ ok: boolean; message: string }> {
  if (!token.trim()) return { ok: false, message: '还没有访问密钥' }
  if (!ids.trim()) return { ok: false, message: '不知道删哪一条' }
  try {
    const response = await requestWithRoute(
      BASE + '/tunnel/delete',
      {
        Authorization: 'Bearer ' + token.trim(),
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      'POST',
      new URLSearchParams({ ids }).toString()
    )
    let parsed: unknown = null
    try {
      parsed = JSON.parse(response.text)
    } catch {
      return { ok: false, message: '接口回了非 JSON（HTTP ' + response.status + '）' }
    }
    const body = parsed as { deleted?: unknown[]; failed?: unknown[]; code?: number; msg?: string }
    if (Array.isArray(body?.deleted) && body.deleted.length) return { ok: true, message: '' }
    if (body?.msg) return { ok: false, message: body.msg }
    return { ok: false, message: '没删掉（HTTP ' + response.status + '）' }
  } catch (error) {
    return { ok: false, message: '连不上樱花接口：' + explainNetwork(error) }
  }
}

interface SakuraEditInput {
  id: number
  note?: string
  localPort?: number
}

/** 改一条已有的隧道：只有备注和本地端口是安全可改的。 */
export async function sakuraEditTunnel(token: string, input: SakuraEditInput): Promise<{ ok: boolean; message: string }> {
  if (!token.trim()) return { ok: false, message: '还没有访问密钥' }
  const form = new URLSearchParams({ id: String(input.id) })
  if (input.note !== undefined) form.set('note', input.note)
  if (input.localPort !== undefined) form.set('local_port', String(input.localPort))
  try {
    const response = await requestWithRoute(
      BASE + '/tunnel/edit',
      {
        Authorization: 'Bearer ' + token.trim(),
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      'POST',
      form.toString()
    )
    let parsed: unknown = null
    try {
      parsed = JSON.parse(response.text)
    } catch {
      return { ok: false, message: '接口回了非 JSON（HTTP ' + response.status + '）' }
    }
    const body = parsed as { code?: number; msg?: string }
    if (body && (body.code === undefined || body.code === 0)) return { ok: true, message: '' }
    return { ok: false, message: body?.msg ?? '改不动（HTTP ' + response.status + '）' }
  } catch (error) {
    return { ok: false, message: '连不上樱花接口：' + explainNetwork(error) }
  }
}
