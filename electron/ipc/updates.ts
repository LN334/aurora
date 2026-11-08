import { ipcMain } from 'electron'
import {
  checkForUpdate,
  downloadAvailable,
  installPendingUpdate,
  openReleasePage,
  updatePrefs
} from '../updates'
import { loadSettings, saveSettings } from '../settings'

/** Release checks, the interval/auto-install preferences, and installing. */
export function registerUpdatesIpc(): void {
  ipcMain.handle('updates:check', () => checkForUpdate())

  // Reuses the release the last check found; asks again if that news is gone.
  ipcMain.handle('updates:download', () => downloadAvailable())

  ipcMain.handle('updates:open', (_event, url: unknown) => {
    if (typeof url !== 'string') return false
    return openReleasePage(url).then(() => true)
  })

  ipcMain.handle('updates:getAutoCheck', () => loadSettings().autoCheckUpdates)

  ipcMain.handle('updates:setAutoCheck', (_event, enabled: unknown) => {
    saveSettings({ autoCheckUpdates: Boolean(enabled) })
    return loadSettings().autoCheckUpdates
  })

  ipcMain.handle('updates:getPrefs', () => updatePrefs())

  ipcMain.handle('updates:setInterval', (_event, interval: unknown) => {
    const next =
      interval === 'manual' || interval === 'daily' || interval === 'weekly' ? interval : 'daily'
    saveSettings({ updateInterval: next })
    return updatePrefs()
  })

  ipcMain.handle('updates:setAutoInstall', (_event, enabled: unknown) => {
    saveSettings({ autoInstallUpdates: Boolean(enabled) })
    return updatePrefs()
  })

  ipcMain.handle('updates:install', () => installPendingUpdate())
}
