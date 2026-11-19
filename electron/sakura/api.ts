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
    node: String(pick(record, ['node_name', 'node', 'nodeName', 'server']) ?? ''),
    type: String(pick(record, ['type', 'protocol']) ?? 'tcp').toLowerCase(),
    localPort: toNumber(pick(record, ['local_port', 'localPort', 'local'])),
    remotePort: toNumber(pick(record, ['remote_port', 'remotePort', 'remote'])),
    online: Boolean(pick(record, ['online', 'is_online', 'running']))
  }
}

export async function sakuraTunnels(token: string): Promise<SakuraTunnelsResult> {
  if (!token.trim()) return { ok: false, message: '还没有访问密钥', tunnels: [], raw: '' }
  try {
    const response = await fetch(BASE + '/tunnels', {
      headers: {
        Authorization: 'Bearer ' + token.trim(),
        Accept: 'application/json'
      }
    })
    const text = await response.text()
    let body: { code?: number; msg?: string; data?: unknown } | null = null
    try {
      body = JSON.parse(text) as { code?: number; msg?: string; data?: unknown }
    } catch {
      /* 不是 JSON：把原文留作证据 */
    }
    if (!body || body.code !== 0) {
      return {
        ok: false,
        message: body?.msg ?? '接口回了 HTTP ' + response.status,
        tunnels: [],
        raw: text.slice(0, 400)
      }
    }
    const list = Array.isArray(body.data) ? body.data : []
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
