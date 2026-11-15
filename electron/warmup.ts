import { ipcMain } from 'electron'
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
export function registerWarmUpIpc(): void {
  /*
   * 渲染层在取数前问一次「谁登录过」：没登录、而它的日推又需要账号的平台，
   * 连 init 都不必跑，省下整个后端的常驻内存。
   */
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
    const jobs: Promise<unknown>[] = []
    let skipped = 0
    for (const id of list) {
      const check = signedIn[id]
      const start = warm[id]
      if (!check || !start) continue
      if (!check()) {
        skipped += 1
        continue
      }
      jobs.push(start())
    }
    if (jobs.length === 0) {
      if (skipped > 0) write(`warmup skipped ${skipped} not signed in`)
      return { warmed: 0, total: 0 }
    }
    const started = Date.now()
    const settled = await Promise.allSettled(jobs)
    const warmed = settled.filter((item) => item.status === 'fulfilled').length
    write(`warmup ${warmed}/${jobs.length} in ${Date.now() - started}ms`)
    return { warmed, total: jobs.length }
  })
}
