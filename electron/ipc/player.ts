import { ipcMain } from 'electron'
import { syncSleepBlocker } from '../power'
import { installThumbar } from '../tray'
import type { PlaybackBridge } from './host'

/** The renderer's playback state, mirrored for the taskbar thumbnail button. */
export function registerPlayerIpc(deps: PlaybackBridge): void {
  ipcMain.handle('player:reportState', (_event, state: { playing?: boolean } | null) => {
    const playing = Boolean(state?.playing)
    if (playing === deps.playing()) return true
    deps.setPlaying(playing)
    // 同一个切换点顺手管休眠：任务栏按钮和电源都只关心「现在是不是在放」。
    syncSleepBlocker(playing)
    const window = deps.window()
    if (window && !window.isDestroyed()) {
      installThumbar(window, playing, deps.sendCommand)
    }
    return true
  })
}
