import { ipcMain } from 'electron'
import { wallpaperInfo, wallpaperList, wallpaperScenePkg } from '../wallpaper'
import { write } from '../startup-log'

/** Wallpaper Engine as a backdrop source: what is on the desktop, and the library. */
export function registerWallpaperIpc(): void {
  /**
   * What Wallpaper Engine currently has on the desktop.
   *
   * Read on demand rather than at startup: the user can switch wallpapers while
   * the player stays open, and `wallpaperInfo(true)` re-probes. The renderer
   * calls this when the backdrop setting is on and again when the window
   * regains focus.
   */
  ipcMain.handle('wallpaper:info', (_event, force) => wallpaperInfo(force === true))

  /** The tiled library the settings page shows, with previews. */
  ipcMain.handle('wallpaper:list', (_event, force) => wallpaperList(force === true))

  /**
   * A scene container's bytes, straight over IPC.
   *
   * The WebGL engine reads `scene.pkg` with `fetch`, and that fails against
   * `aurora-wallpaper://` in the renderer (images and video are fine - only
   * `fetch` is refused). Without this the large scenes never mount and the
   * backdrop degrades to a 230px preview. The package is read whole because the
   * engine wants one ArrayBuffer; 144 MB is the largest project in the local
   * library.
   */
  ipcMain.handle('wallpaper:scenePkg', async (_event, id) => {
    const startedAt = Date.now()
    const bytes = await wallpaperScenePkg(String(id ?? ''))
    if (!bytes) {
      write(`wallpaper: scenePkg ${id} not available`)
      return null
    }
    write(`wallpaper: scenePkg ${id} read ${bytes.byteLength} bytes in ${Date.now() - startedAt}ms`)
    return bytes
  })
}
