import { ipcMain } from 'electron'
import { PLATFORM_IDS, platformSummary, type PlatformId, type PlatformState, type PlatformStatus } from './pure/platform-status'
import {
  activeProfile as neteaseProfile,
  neteaseWarmUp,
  profileHasSession as neteaseHasSession
} from './netease/client'
import {
  activeProfile as kugouProfile,
  ensureServer,
  profileHasSession as kugouHasSession
} from './kugou/client'
import { activeProfile as qqProfile, profileHasSession as qqHasSession, qqStatus } from './qq/client'
import {
  activeProfile as qishuiProfile,
  profileHasSession as qishuiHasSession,
  qishuiStatus
} from './qishui/client'
import { write } from './startup-log'

/*
 * 四家用同一张表、同一套判据，没有「谁特殊」的分支。
 *
 * 预热本身会拉起后端：网易云那一步要 require 上游 API 包（常驻 +93 MB），酷狗要
 * spawn 本地服务。没登录的平台其实用不上这些——游客能看的公开榜单，首页取数时会
 * 自己 init，那时才付出这笔代价。
 */
const signedIn: Record<string, () => boolean> = {
  netease: () => neteaseHasSession(neteaseProfile()),
  kugou: () => kugouHasSession(kugouProfile()),
  qq: () => qqHasSession(qqProfile()),
  qishui: () => qishuiHasSession(qishuiProfile())
}

const warm: Record<string, () => Promise<unknown>> = {
  netease: neteaseWarmUp,
  kugou: ensureServer,
  qq: qqStatus,
  qishui: qishuiStatus
}

/**
 * 首帧之后把「勾选了、并且登录过」的平台先热起来。
 *
 * 各家冷启动都有固定开销：酷狗要 spawn 本地服务、网易云要完成设备握手、QQ 和
 * 汽水要读一次会话文件。首页首轮取数要等组件挂载后才踢它们，提前几百毫秒让它们
 * 在后台跑完，用户点进漫游或搜索时就不用等。
 *
 * 没登录的那几家直接跳过：预热会把它们的后端整个拉进内存，而游客状态下这点收益
 * 抵不上代价。等首页取数或用户点进在线页时，由渲染层的 init 按需拉起。
 */
/** 四家谁登录着。导出日志里用；渲染层的 `platforms:signedIn` 也走这张表。 */
export function signedInPlatforms(): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const [id, check] of Object.entries(signedIn)) result[id] = check()
  return result
}

/**
 * 四个后端的状态表。
 *
 * 预热与「重新连接」共用同一条探活路径：调一次该家的 warm()，成功记 ready、失败
 * 记 error（明确断网的记 offline）。渲染层不再各自拉 status，而是订阅这张表的
 * 变化——四家的字段本来就不一样，归一之后界面才能用同一套话去说。
 */
const states: Record<PlatformId, { state: PlatformState; detail: string; at: number }> = {
  netease: { state: 'idle', detail: '', at: 0 },
  qq: { state: 'idle', detail: '', at: 0 },
  kugou: { state: 'idle', detail: '', at: 0 },
  qishui: { state: 'idle', detail: '', at: 0 }
}

let broadcaster: (channel: string, payload: unknown) => void = () => undefined

/** 主进程启动时把「推给所有窗口」的实现交进来。 */
export function setPlatformStatusBroadcaster(fn: (channel: string, payload: unknown) => void): void {
  broadcaster = fn
}

function snapshot(): PlatformStatus[] {
  const signed = signedInPlatforms()
  return PLATFORM_IDS.map((id) => {
    const row = states[id]
    return { id, state: row.state, detail: row.detail, loggedIn: signed[id] ?? null, at: row.at }
  })
}

function publish(): void {
  const list = snapshot()
  broadcaster('platforms:changed', { list, summary: platformSummary(list) })
}

function isOffline(error: unknown): boolean {
  const text = String((error as { code?: string; message?: string })?.code ?? (error as { message?: string })?.message ?? error)
  return /E(NOTFOUND|CONNREFUSED|CONNRESET|NETUNREACH|HOSTUNREACH|TIMEDOUT|AI_AGAIN)/i.test(text)
}

/**
 * 探活一家：拉起它、记下结果。
 *
 * 并发调用共用同一次：连续点两下「重新连接」不该同时拉起两份后端。
 */
const inflight = new Map<PlatformId, Promise<PlatformStatus>>()

function probePlatform(id: PlatformId): Promise<PlatformStatus> {
  const running = inflight.get(id)
  if (running) return running
  const task = (async () => {
    states[id] = { state: 'starting', detail: '', at: Date.now() }
    publish()
    try {
      await warm[id]()
      states[id] = { state: 'ready', detail: '', at: Date.now() }
    } catch (error) {
      const detail = String((error as { message?: string })?.message ?? error).slice(0, 200)
      states[id] = { state: isOffline(error) ? 'offline' : 'error', detail, at: Date.now() }
    } finally {
      inflight.delete(id)
    }
    publish()
    const row = states[id]
    return { id, state: row.state, detail: row.detail, loggedIn: signedInPlatforms()[id] ?? null, at: row.at }
  })()
  inflight.set(id, task)
  return task
}

/** 四家状态 + 一句摘要。 */
function platformStatusSnapshot(): { list: PlatformStatus[]; summary: string } {
  const list = snapshot()
  return { list, summary: platformSummary(list) }
}

export function registerWarmUpIpc(): void {
  /*
   * 渲染层在取数前问一次「谁登录过」：没登录、而它的日推又需要账号的平台，
   * 连 init 都不必跑，省下整个后端的常驻内存。
   */
  /* 状态查询与重新连接。渲染层订 platforms:changed，不再各自轮询。 */
  ipcMain.handle('platforms:status', () => platformStatusSnapshot())
  ipcMain.handle('platforms:retry', (_event, id: unknown) => {
    const key = String(id) as PlatformId
    if (!PLATFORM_IDS.includes(key)) return { ok: false, reason: 'unknown platform' }
    /* 不 await：立即返回，结果由 platforms:changed 推回去。 */
    void probePlatform(key)
    return { ok: true }
  })

  ipcMain.handle('platforms:signedIn', () => {
    const result: Record<string, boolean> = {}
    for (const [id, check] of Object.entries(signedIn)) result[id] = check()
    return result
  })

  ipcMain.handle('platforms:warmUp', async (_event, ids: unknown) => {
    const list = Array.isArray(ids)
      ? [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
      : []
    if (list.length === 0) return { warmed: 0, total: 0 }
    const jobs: Promise<PlatformStatus>[] = []
    let skipped = 0
    for (const id of list) {
      const check = signedIn[id]
      if (!check || !warm[id as PlatformId]) continue
      if (!check()) {
        skipped += 1
        continue
      }
      /*
       * 走 probePlatform 而不是直接调 warm[id]：预热本身就要把后端拉起来，
       * 顺带记下「成了还是没成」，界面那块状态表才有内容。两件事一条路。
       */
      jobs.push(probePlatform(id as PlatformId))
    }
    if (jobs.length === 0) {
      if (skipped > 0) write(`warmup skipped ${skipped} not signed in`)
      return { warmed: 0, total: 0 }
    }
    const started = Date.now()
    /* probePlatform 自己捕获错误，所以这里不会 reject；按结果里的状态数。 */
    const settled = await Promise.all(jobs)
    const warmed = settled.filter((item) => item.state === 'ready').length
    write(`warmup ${warmed}/${jobs.length} in ${Date.now() - started}ms`)
    return { warmed, total: jobs.length }
  })
}
