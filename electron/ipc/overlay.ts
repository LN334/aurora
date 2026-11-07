import { ipcMain } from 'electron'
import {
  pushOverlayState,
  setHitArea as setOverlayHitArea,
  setLocked as setOverlayLocked,
  status as overlayStatus,
  toggleOverlay,
  type OverlayState
} from '../lyrics-overlay'

/** The desktop-lyrics window: open/close, lock, hit box and lyric pushes. */
export function registerOverlayIpc(): void {
  ipcMain.handle('overlay:toggle', (_event, enabled: unknown) =>
    toggleOverlay(typeof enabled === 'boolean' ? enabled : undefined)
  )

  ipcMain.handle('overlay:status', () => overlayStatus())

  ipcMain.handle('overlay:setLocked', (_event, locked: unknown) => setOverlayLocked(Boolean(locked)))

  // The strip reports where its words are; the main process polls the cursor
  // against that box so a locked window takes the mouse only over the lyrics.
  ipcMain.handle('overlay:hit-area', (_event, rect: unknown) => setOverlayHitArea(rect))

  ipcMain.handle('overlay:close', () => {
    toggleOverlay(false)
    return overlayStatus()
  })

  ipcMain.handle('overlay:push', (_event, state: unknown) => {
    // Renderer input crossing a trust boundary, so the shape is rebuilt here
    // rather than trusted from the message.
    if (!state || typeof state !== 'object') return false
    const candidate = state as Partial<OverlayState>
    pushOverlayState({
      text: typeof candidate.text === 'string' ? candidate.text : null,
      next: typeof candidate.next === 'string' ? candidate.next : null,
      title: typeof candidate.title === 'string' ? candidate.title : '',
      artist: typeof candidate.artist === 'string' ? candidate.artist : '',
      playing: Boolean(candidate.playing)
    })
    return true
  })
}
