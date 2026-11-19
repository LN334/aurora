import { BrowserWindow } from 'electron'
import path from 'node:path'
import { APP_ORIGIN } from './protocols/app-protocol'

/** 樱花隧道窗口。单例。 */
let sakuraWindow: BrowserWindow | null = null
const DEV_URL = process.env.AURORA_DEV_URL ?? ''

export function sakuraWindowOpen(): boolean {
  if (sakuraWindow && !sakuraWindow.isDestroyed()) {
    sakuraWindow.show()
    sakuraWindow.focus()
    return true
  }
  sakuraWindow = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 460,
    minHeight: 480,
    title: '樱花隧道',
    backgroundColor: '#10141a',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  sakuraWindow.on('closed', () => {
    sakuraWindow = null
  })
  const load = async (): Promise<void> => {
    try {
      if (DEV_URL) await sakuraWindow?.loadURL(`${DEV_URL}/sakura.html`)
      else await sakuraWindow?.loadURL(`${APP_ORIGIN}/sakura.html`)
    } catch {
      /* 窗口留着，用户看到的是空的而不是「没反应」 */
    }
  }
  void load()
  return true
}
