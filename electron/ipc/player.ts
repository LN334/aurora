import { ipcMain } from 'electron'
import { installThumbar } from '../tray'
import type { PlaybackBridge } from './host'

/** The renderer's playback state, mirrored for the taskbar thumbnail button. */
export function registerPlayerIpc(deps: PlaybackBridge): void {
  ipcMain.handle('player:reportState', (_event, state: { playing?: boolean } | null) => {
    const playing = Boolean(state?.playing)
    if (playing === deps.playing()) return true
    deps.setPlaying(playing)
    const window = deps.window()
    if (window && !window.isDestroyed()) {
      installThumbar(window, playing, deps.sendCommand)
    }
    return true
  })
}
