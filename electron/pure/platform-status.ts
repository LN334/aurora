/**
 * 四个平台后端的状态。
 *
 * 借鉴 Folia 的 `createBackendStatus`：状态只有一个来源、只有几种取值，变化就推给
 * 所有窗口。我们原来每家一个 `xxx.status()`，字段各不相同（`ready` / `loggedIn` /
 * `detail`），且只能由渲染层主动拉——后端起不来时界面是「点了没反应」，日志里才有
 * 一行原因。
 *
 * 这里把四家的形状归一成一份，并规定「什么算故障」。
 */

export type PlatformId = 'netease' | 'qq' | 'kugou' | 'qishui'

export const PLATFORM_IDS: PlatformId[] = ['netease', 'qq', 'kugou', 'qishui']

/**
 * `idle` 没拉起、`starting` 正在拉、`ready` 可用、`error` 拉了但失败、
 * `offline` 明确因为断网而没起来（和 error 分开：断网不需要用户重装或清缓存）。
 */
export type PlatformState = 'idle' | 'starting' | 'ready' | 'error' | 'offline'

export interface PlatformStatus {
  id: PlatformId
  state: PlatformState
  /** 一句人话，成功时为空。 */
  detail: string
  /** 账号是否登录着；拿不到就是 null。 */
  loggedIn: boolean | null
  /** 最近一次变化的时间戳（毫秒）。 */
  at: number
}

/** 各家 `status()` 返回的最小公共形状；字段缺失按未知处理。 */
interface RawPlatformStatus {
  ready?: boolean
  loggedIn?: boolean
  detail?: string
  offline?: boolean
}

/**
 * 把一家的状态折成统一的五种之一。
 *
 * 判定顺序有讲究：`offline` 优先于 `error`——断网时上游报的是连接错误，
 * 归成 error 会让页面去提示「清理缓存重装」，而用户只需要换个网络。
 */
export function normalizePlatformStatus(
  id: PlatformId,
  raw: RawPlatformStatus | null | undefined,
  at = Date.now()
): PlatformStatus {
  const detail = typeof raw?.detail === 'string' ? raw.detail.trim() : ''
  const loggedIn = typeof raw?.loggedIn === 'boolean' ? raw.loggedIn : null
  if (!raw) return { id, state: 'idle', detail, loggedIn, at }
  if (raw.offline === true) return { id, state: 'offline', detail: detail || '网络不通', loggedIn, at }
  if (raw.ready === true) return { id, state: 'ready', detail: '', loggedIn, at }
  if (detail.length > 0) return { id, state: 'error', detail, loggedIn, at }
  return { id, state: 'idle', detail: '', loggedIn, at }
}

/** 整体一句话：全好给空串，否则点名几家的故障。 */
export function platformSummary(list: PlatformStatus[]): string {
  const broken = list.filter((item) => item.state === 'error' || item.state === 'offline')
  if (broken.length === 0) return ''
  const names: Record<PlatformId, string> = {
    netease: '网易云',
    qq: 'QQ 音乐',
    kugou: '酷狗',
    qishui: '汽水'
  }
  const head = broken
    .map((item) => names[item.id] + (item.state === 'offline' ? '网络不通' : '没起来'))
    .join('、')
  const first = broken.find((item) => item.detail.length > 0)
  return first ? head + '（' + first.detail + '）' : head
}
