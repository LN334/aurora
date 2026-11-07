import { app } from 'electron'
import { loadSettings } from './settings'

/**
 * 开机自启的注册表/服务开关。
 *
 * 设置文件里的 `launchAtLogin` 是用户的意图，系统的登录项是它的实现。两者
 * 可能不同步——重装、换路径、被安全软件清理都会让注册项消失——所以每次启动
 * 都按意图重写一次，而不是只在用户拨开关时写。
 *
 * 开发态（未打包）不碰系统登录项：往注册表里塞一个 electron.exe 指向源码路径
 * 的启动项，对用户没有意义，也难清理。
 */
export function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: enabled,
    // 自启时带上标记，主进程据此把窗口收进托盘、不抢开机第一屏。
    args: enabled ? ['--autostart'] : []
  })
}

/** 启动时把系统状态拉回设置文件说的那个样子。 */
export function syncLoginItem(): void {
  applyLoginItem(loadSettings().launchAtLogin === true)
}
