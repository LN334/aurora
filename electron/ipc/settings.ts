import { ipcMain } from 'electron'
import {
  LYRIC_SIZE_MAX,
  LYRIC_SIZE_MIN,
  appSettings,
  clearCache,
  saveSettings,
  storageUsage
} from '../settings'
import { setLyricSize } from '../lyrics-overlay'
import type { WindowSource } from './host'

/** The settings page's typed setters, plus the two window-level actions. */
export function registerSettingsIpc(deps: WindowSource): void {
  /*
   * One narrow setter per field, deliberately. A generic `settings:set(key,
   * value)` would make the renderer able to write any key into the main
   * process's config, including ones it has no business touching.
   */
  ipcMain.handle('settings:getAll', () => appSettings())

  ipcMain.handle('settings:setOnlineLyrics', (_event, enabled: unknown) => {
    saveSettings({ onlineLyrics: Boolean(enabled) })
    return appSettings()
  })

  ipcMain.handle('settings:setDesktopLyricsSize', (_event, size: unknown) => {
    const value = typeof size === 'number' && Number.isFinite(size) ? size : LYRIC_SIZE_MIN
    setLyricSize(Math.min(LYRIC_SIZE_MAX, Math.max(LYRIC_SIZE_MIN, value)))
    return appSettings()
  })

  ipcMain.handle('settings:setCloseToTray', (_event, enabled: unknown) => {
    saveSettings({ closeToTray: Boolean(enabled) })
    return appSettings()
  })

  ipcMain.handle('settings:storage', () => storageUsage())

  ipcMain.handle('settings:clearCache', () => clearCache())

  /*
   * 全屏是一个动作，不是一个「记住」的状态：和窗口自身的 F11 一样，
   * 下次启动回到普通窗口，用户不会遇到一个自己没设过的全屏播放器。
   */
  ipcMain.handle('window:toggleFullscreen', () => {
    const window = deps.window()
    if (!window || window.isDestroyed()) return false
    const next = !window.isFullScreen()
    window.setFullScreen(next)
    return next
  })

  ipcMain.handle('window:isFullscreen', () => Boolean(deps.window()?.isFullScreen()))
}
