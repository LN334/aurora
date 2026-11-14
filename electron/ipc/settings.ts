import { ipcMain, shell } from 'electron'
import {
  LYRIC_SIZE_MAX,
  LYRIC_SIZE_MIN,
  appSettings,
  clearCache,
  saveSettings,
  storageUsage
} from '../settings'
import { applyOverlayHoverSetting, setLyricSize } from '../lyrics-overlay'
import { syncSleepBlocker } from '../power'
import { applyLoginItem } from '../login-item'
import { mediaCache } from '../media-cache-instance'
import type { WindowSource } from './host'

/** The settings page's typed setters, plus the two window-level actions. */
export function registerSettingsIpc(deps: WindowSource, playing: () => boolean): void {
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

  ipcMain.handle('settings:setLaunchAtLogin', (_event, enabled: unknown) => {
    const next = Boolean(enabled)
    saveSettings({ launchAtLogin: next })
    applyLoginItem(next)
    return appSettings()
  })

  ipcMain.handle('settings:setPreventSleep', (_event, enabled: unknown) => {
    const next = Boolean(enabled)
    saveSettings({ preventSleepWhilePlaying: next })
    // 立刻生效：正在放歌时关掉它，应该当场允许系统重新计时休眠。
    syncSleepBlocker(playing())
    return appSettings()
  })

  ipcMain.handle('settings:setOpenAfterDownload', (_event, enabled: unknown) => {
    saveSettings({ openAfterDownload: Boolean(enabled) })
    return appSettings()
  })

  ipcMain.handle('settings:setTrayClick', (_event, mode: unknown) => {
    // 枚举在这里收窄：配置里只该出现这两个字面量，别把渲染层传来的东西原样存下去。
    saveSettings({ trayClick: mode === 'show' ? 'show' : 'toggle' })
    return appSettings()
  })

  ipcMain.handle('settings:setOverlayHoverControls', (_event, enabled: unknown) => {
    saveSettings({ overlayHoverControls: Boolean(enabled) })
    // 立刻生效：正锁着的时候关掉它，应该当场变成完全穿透，而不是下次开窗才算。
    applyOverlayHoverSetting()
    return appSettings()
  })

  ipcMain.handle('settings:storage', () => storageUsage())

  ipcMain.handle('settings:clearCache', () => clearCache())

  /*
   * 在线音频缓存：上限、占用、清空、打开位置。
   *
   * 改上限立刻按新预算淘汰一次——否则用户把 2GB 拉到 200MB，看到的还是 2GB
   * 占用，要等下次写入才动。清空与打开目录只碰 media-cache 这一个目录，
   * 下载目录（用户自己的文件）不在这个按钮的射程里。
   */
  ipcMain.handle('settings:setMediaCacheLimit', async (_event, megabytes: unknown) => {
    const value = typeof megabytes === 'number' && Number.isFinite(megabytes) ? megabytes : 2048
    const clamped = Math.min(10_240, Math.max(0, Math.round(value)))
    saveSettings({ mediaCacheLimitMb: clamped })
    await mediaCache().setLimit(clamped)
    return appSettings()
  })

  ipcMain.handle('mediaCache:stats', () => mediaCache().stats())

  ipcMain.handle('mediaCache:clear', async () => {
    await mediaCache().clear()
    return mediaCache().stats()
  })

  ipcMain.handle('mediaCache:openFolder', async () => {
    const { directory } = await mediaCache().stats()
    await shell.openPath(directory)
  })

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
