import { app, ipcMain } from 'electron'
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
}
