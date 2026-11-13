import { ipcMain } from 'electron'
import { neteaseWarmUp } from './netease/client'
import { ensureServer } from './kugou/client'
import { qqStatus } from './qq/client'
import { qishuiStatus } from './qishui/client'
import { write } from './startup-log'

/**
 * 开屏期间把勾选的推流平台先热起来。
 *
 * 各家冷启动都有固定开销：酷狗要 spawn 本地服务、网易云要完成设备握手、QQ 和
 * 汽水要读一次会话文件。首页首轮取数要等组件挂载后才踢它们，而开屏本来就要盖住
 * 那段时间，正好让它们在背后跑完。
 *
 * 只做与账号无关的前半段，全部单飞幂等：重复调用命中已热的缓存，不会多打请求。
 * 登录态、歌单这些仍然由渲染层的 init 去问，这里只负责「后端先起来」。
 */
export function registerWarmUpIpc(): void {
  ipcMain.handle('platforms:warmUp', async (_event, ids: unknown) => {
    const list = Array.isArray(ids)
      ? [...new Set(ids.filter((id): id is string => typeof id === 'string'))]
      : []
    if (list.length === 0) return { warmed: 0, total: 0 }
    const jobs: Promise<unknown>[] = []
    for (const id of list) {
      if (id === 'netease') jobs.push(neteaseWarmUp())
      else if (id === 'kugou') jobs.push(ensureServer())
      else if (id === 'qq') jobs.push(qqStatus())
      else if (id === 'qishui') jobs.push(qishuiStatus())
    }
    if (jobs.length === 0) return { warmed: 0, total: 0 }
    const started = Date.now()
    const settled = await Promise.allSettled(jobs)
    const warmed = settled.filter((item) => item.status === 'fulfilled').length
    write(`warmup ${warmed}/${jobs.length} in ${Date.now() - started}ms`)
    return { warmed, total: jobs.length }
  })
}
