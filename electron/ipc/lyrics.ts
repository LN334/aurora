import { ipcMain } from 'electron'
import { loadSettings, saveSettings } from '../settings'
import { lookupLyrics, type LyricsQuery } from '../lyrics'

/** Online lyric lookup, gated on the setting that enables the network egress. */
export function registerLyricsIpc(): void {
  ipcMain.handle('lyrics:isOnlineEnabled', () => loadSettings().onlineLyrics)

  ipcMain.handle('lyrics:setOnlineEnabled', (_event, enabled: unknown) => {
    saveSettings({ onlineLyrics: Boolean(enabled) })
    return loadSettings().onlineLyrics
  })

  ipcMain.handle('lyrics:lookup', (_event, query: unknown) => {
    // The setting is enforced here, not in the renderer: the network egress is
    // the thing being gated, so the gate belongs on the side that does it.
    if (!loadSettings().onlineLyrics) return null
    if (!query || typeof query !== 'object') return null

    const candidate = query as Partial<LyricsQuery>
    if (typeof candidate.title !== 'string' || !candidate.title.trim()) return null

    return lookupLyrics({
      title: candidate.title,
      artist: typeof candidate.artist === 'string' ? candidate.artist : '',
      album: typeof candidate.album === 'string' ? candidate.album : '',
      duration: typeof candidate.duration === 'number' ? candidate.duration : 0
    })
  })
}
