import { BrowserWindow } from 'electron'
import path from 'node:path'
import { APP_ORIGIN } from './protocols/app-protocol'

/** 聊天室窗口。单例：重复打开只把已有那扇提到前面。 */
let chatWindow: BrowserWindow | null = null
const DEV_URL = process.env.AURORA_DEV_URL ?? ''

export function chatWindowOpen(): boolean {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show()
    chatWindow.focus()
    return true
  }
  chatWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 340,
    minHeight: 360,
    title: '一起听 · 聊天',
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
  chatWindow.on('closed', () => {
    chatWindow = null
  })
  const load = async (): Promise<void> => {
    try {
      if (DEV_URL) await chatWindow?.loadURL(`${DEV_URL}/chat.html`)
      else await chatWindow?.loadURL(`${APP_ORIGIN}/chat.html`)
    } catch {
      /* 窗口留着，用户看到的是空的而不是「没反应」 */
    }
  }
  void load()
  return true
}
