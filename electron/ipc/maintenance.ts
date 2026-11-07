import { ipcMain } from 'electron'
import { releaseMemory, scanJunk, sweepJunk } from '../maintenance'

/** 设置页 05 清理与维护的两个入口。 */
export function registerMaintenanceIpc(): void {
  // 释放内存是对本应用自己进程的动作，不收参数，也不可能指向别的进程。
  ipcMain.handle('maintenance:memory', () => releaseMemory())

  ipcMain.handle('maintenance:scan', () => scanJunk())

  // sweepJunk 自己白名单过滤 id，渲染层拼错也只会什么都不删。
  ipcMain.handle('maintenance:clean', (_event, ids: unknown) => sweepJunk(ids))
}
