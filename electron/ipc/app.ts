import { app, ipcMain, shell } from 'electron'
import { mainWindowVisibility } from '../pure/scan-progress'
import type { WindowSource } from './host'

/** Application facts, and whether the player window is on screen. */
export function registerAppIpc(deps: WindowSource): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userData: app.getPath('userData')
  }))

  /*
   * Whether the player window is actually on screen. The renderer asks once at
   * startup and then follows `app:visibility`; see notifyVisibility() in main.ts.
   */
  ipcMain.handle('app:visibility', () => mainWindowVisibility(deps.window()))

  /*
   * 打开外部链接：只放行 GitHub。
   *
   * 关于页的仓库与反馈按钮走这里。渲染层永远拿不到 shell，白名单放在主进程，
   * 页面即使被注入脚本也打不开 file:// 或任意站点。
   */
  ipcMain.handle('app:openExternal', (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https:\/\/github\.com\//.test(url)) return false
    void shell.openExternal(url)
    return true
  })
}
