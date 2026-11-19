import { BrowserWindow } from 'electron'
import path from 'node:path'
import { APP_ORIGIN } from './protocols/app-protocol'

/**
 * 一起听的独立窗口。
 *
 * 单例：重复点播放条那颗键只是把已有窗口提到前面，不会再开一扇。关掉之后
 * 房间本身不受影响——房间活在主进程里，窗口只是一块看板。
 */
let partyWindow: BrowserWindow | null = null
const DEV_URL = process.env.AURORA_DEV_URL ?? ''

export function partyWindowOpen(): boolean {
  if (partyWindow && !partyWindow.isDestroyed()) {
    partyWindow.show()
    partyWindow.focus()
    return true
  }
  partyWindow = new BrowserWindow({
    width: 640,
    height: 620,
    minWidth: 520,
    minHeight: 420,
    title: '一起听',
    backgroundColor: '#10141a',
    /*
     * 不要系统标题栏：这扇窗只有一起听，标题栏上那行字和三个按钮全是噪音，
     * 关窗用面板自己那颗 ×。拖动交给面板顶部（CSS 的 app-region: drag）。
     */
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  partyWindow.on('closed', () => {
    partyWindow = null
  })
  const load = async (): Promise<void> => {
    try {
      if (DEV_URL) await partyWindow?.loadURL(`${DEV_URL}/party.html`)
      else await partyWindow?.loadURL(`${APP_ORIGIN}/party.html`)
    } catch {
      /* 加载失败时窗口留着，用户能看到是空的而不是「没反应」 */
    }
  }
  void load()
  return true
}
