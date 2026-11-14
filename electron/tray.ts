import {
  app,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  type NativeImage
} from 'electron'
import path from 'node:path'
import { customTrayImage } from './app-icon'

/**
 * System tray and taskbar thumbnail toolbar.
 *
 * Icons live in `assets/icons/`, which is on the packaged file list, rather than
 * in `build/`, which electron-builder only reads at build time. Loading from
 * build/ would produce a packaged app with a blank tray slot.
 */

export type MediaCommand = 'toggle' | 'next' | 'prev' | 'volume-up' | 'volume-down'

export interface TrayHandlers {
  toggleWindow(): void
  isWindowVisible(): boolean
  command(command: MediaCommand): void
  /** 单击托盘图标。行为可配，所以由主进程决定，这里只转发。 */
  trayClick(): void
  quit(): void
  /**
   * Items inserted above Quit. Keeps this module from having to know about
   * features it does not own.
   */
  extraItems?(): MenuItemConstructorOptions[]
}

const iconFile = (name: string): string =>
  path.join(app.getAppPath(), 'assets', 'icons', name)

function loadIcon(name: string): NativeImage {
  const image = nativeImage.createFromPath(iconFile(name))
  if (image.isEmpty()) {
    // An empty image silently renders as a blank slot, which is very hard to
    // diagnose from the running app.
    console.error('[aurora] icon missing or unreadable:', iconFile(name))
  }
  return image
}

let tray: Tray | null = null

/**
 * Windows does not invert an Electron tray image, so a white glyph disappears
 * on a light taskbar and a dark one disappears on the dark default. Pick by
 * theme and rebuild when the theme changes.
 */
function trayImage(): NativeImage {
  // 用户换过图标就让托盘跟着换：他动图标是为了在任务栏上认出来，托盘漏掉就不算换了。
  const custom = customTrayImage()
  if (custom) return custom
  return loadIcon(nativeTheme.shouldUseDarkColors ? 'tray.png' : 'tray-dark.png')
}

/** 图标换过之后重设托盘；托盘还没建出来时什么也不做。 */
export function refreshTrayImage(): void {
  if (!tray || tray.isDestroyed()) return
  tray.setImage(trayImage())
}

/**
 * 系统气泡。托盘窗口收起来时用它说一句，别让窗口凭空消失。
 *
 * 用气泡而不是应用内提示：提示画在那个已经隐藏的窗口里，用户看不见。
 */
export function showTrayBalloon(title: string, content: string): void {
  if (!tray || tray.isDestroyed()) return
  tray.displayBalloon({ title, content, iconType: 'info', noSound: true })
}

export function refreshTrayMenu(handlers: TrayHandlers): void {
  if (!tray) return
  const template: MenuItemConstructorOptions[] = [
    { label: '播放 / 暂停', click: () => handlers.command('toggle') },
    { label: '上一首', click: () => handlers.command('prev') },
    { label: '下一首', click: () => handlers.command('next') },
    { type: 'separator' },
    {
      label: handlers.isWindowVisible() ? '隐藏窗口' : '显示窗口',
      click: () => handlers.toggleWindow()
    }
  ]

  const extra = handlers.extraItems?.() ?? []
  if (extra.length > 0) template.push(...extra)

  template.push({ type: 'separator' }, { label: '退出 Aurora', click: () => handlers.quit() })

  tray.setContextMenu(Menu.buildFromTemplate(template))
}

export function createTray(handlers: TrayHandlers): Tray {
  tray = new Tray(trayImage())
  tray.setToolTip('Aurora')
  tray.on('click', () => handlers.trayClick())
  refreshTrayMenu(handlers)

  nativeTheme.on('updated', () => {
    tray?.setImage(trayImage())
  })

  return tray
}

/** True when a tray icon exists, i.e. when hiding the window is recoverable. */
export function hasTray(): boolean {
  return tray !== null && !tray.isDestroyed()
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

/** Windows thumbnail toolbar: transport buttons under the taskbar preview. */
export function installThumbar(
  window: BrowserWindow,
  playing: boolean,
  onCommand: (command: MediaCommand) => void
): void {
  if (window.isDestroyed()) return
  window.setThumbarButtons([
    { tooltip: '上一首', icon: loadIcon('thumb-prev.png'), click: () => onCommand('prev') },
    {
      tooltip: playing ? '暂停' : '播放',
      icon: loadIcon(playing ? 'thumb-pause.png' : 'thumb-play.png'),
      click: () => onCommand('toggle')
    },
    { tooltip: '下一首', icon: loadIcon('thumb-next.png'), click: () => onCommand('next') }
  ])
}
