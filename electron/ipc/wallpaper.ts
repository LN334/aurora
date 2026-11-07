import { ipcMain } from 'electron'
import { wallpaperInfo, wallpaperList } from '../wallpaper'

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
}
