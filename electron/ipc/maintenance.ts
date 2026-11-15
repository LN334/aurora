import { ipcMain } from 'electron'
import { exportBackup, restoreBackup } from '../backup'
import { openDataDirectory, releaseMemory, scanJunk, sweepJunk } from '../maintenance'

/** 设置页 05 清理与维护的几个入口。 */
export function registerMaintenanceIpc(): void {
  // 释放内存是对本应用自己进程的动作，不收参数，也不可能指向别的进程。
  ipcMain.handle('maintenance:memory', () => releaseMemory())

  ipcMain.handle('maintenance:scan', () => scanJunk())

  // sweepJunk 自己白名单过滤 id，渲染层拼错也只会什么都不删。
  ipcMain.handle('maintenance:clean', (_event, ids: unknown) => sweepJunk(ids))

  /*
   * 备份的持久化键只能由渲染层交上来 —— localStorage 不在主进程手里。
   * 主进程负责选路径、写文件、校验格式；参数照旧当成不可信输入洗一遍。
   */
  ipcMain.handle('backup:export', (_event, storage: unknown) => exportBackup(readStorage(storage)))

  ipcMain.handle('backup:restore', () => restoreBackup())

  // 打开的目录固定是 app.getPath('userData')，渲染层传不进别的路径。
  ipcMain.handle('maintenance:openDataDir', () => openDataDirectory())
}

function readStorage(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

