import fs from 'node:fs'
import path from 'node:path'
import { dialog, ipcMain, shell } from 'electron'
import { discoverMusicFolders } from '../library-discovery'
import { loadIndex, scanLibrary, type ScanProgress } from '../library-scan'
import { isInsideRoots, loadSettings, saveSettings } from '../settings'
import { sendProgress } from '../pure/scan-progress'
import type { ScanControl, ScanSlot, WindowSource } from './host'

/**
 * Decode a lyrics file. Chinese `.lrc` files are still very often GBK-encoded
 * rather than UTF-8, and a strict UTF-8 decode is the only reliable way to tell
 * the difference before falling back.
 */
function decodeText(buffer: Buffer): string {
  const body =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    try {
      return new TextDecoder('gbk').decode(body)
    } catch {
      return body.toString('utf8')
    }
  }
}

/** The local library: folders, the scan, sidecar lyrics, and m3u playlists. */
export function registerLibraryIpc(deps: WindowSource & ScanSlot): void {
  ipcMain.handle('library:getRoots', () => loadSettings().roots)

  /**
   * Folders already on this machine, added once.
   *
   * Only ever runs for a profile that has no folders *and* no record of having
   * had any: `library:getRoots` returning `[]` is also what a user sees after
   * deliberately removing every folder, and re-adding them on the next launch
   * would make the remove button look broken. The flag makes this a first-run
   * action rather than a recurring opinion.
   */
  ipcMain.handle('library:autoDiscover', () => {
    const settings = loadSettings()
    if (settings.roots.length > 0 || settings.rootsDiscovered) return { added: [] as string[], roots: settings.roots }

    const found = discoverMusicFolders()
    saveSettings({ roots: found, rootsDiscovered: true })
    return { added: found, roots: found }
  })

  ipcMain.handle('library:addRoots', async () => {
    const current = loadSettings().roots
    const window = deps.window()
    if (!window) return current
    const result = await dialog.showOpenDialog(window, {
      title: '选择音乐文件夹',
      buttonLabel: '加入曲库',
      properties: ['openDirectory', 'multiSelections', 'dontAddToRecent']
    })
    if (result.canceled || result.filePaths.length === 0) return current
    const merged = Array.from(new Set([...current, ...result.filePaths.map((p) => path.resolve(p))]))
    saveSettings({ roots: merged })
    return merged
  })

  ipcMain.handle('library:removeRoot', (_event, root: string) => {
    const next = loadSettings().roots.filter((candidate) => candidate !== root)
    saveSettings({ roots: next })
    return next
  })

  /**
   * Show a track in the OS file manager.
   *
   * The path arrives from the renderer, so it is checked against the folders the
   * user actually added. Without that, a compromised renderer could ask the shell
   * to reveal any path on the machine.
   */
  ipcMain.handle('library:reveal', (_event, trackPath: unknown) => {
    if (typeof trackPath !== 'string' || !trackPath) return false
    if (!isInsideRoots(trackPath)) return false
    shell.showItemInFolder(trackPath)
    return true
  })

  ipcMain.handle('library:readLyrics', async (_event, trackPath: unknown) => {
    if (typeof trackPath !== 'string' || !isInsideRoots(trackPath)) return null
    const directory = path.dirname(trackPath)
    const stem = path.basename(trackPath, path.extname(trackPath))
    const candidates = [
      path.join(directory, `${stem}.lrc`),
      path.join(directory, `${stem}.LRC`),
      // One shared lyric file for a folder, for albums ripped as a single file.
      path.join(directory, 'lyrics.lrc')
    ]
    for (const candidate of candidates) {
      try {
        return decodeText(await fs.promises.readFile(candidate))
      } catch {
        // A missing candidate is the normal case, not an error.
      }
    }
    return null
  })

  ipcMain.handle('library:getIndex', () => loadIndex())

  ipcMain.handle('playlists:import', async () => {
    const window = deps.window()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: '导入 m3u 播放列表',
      filters: [{ name: '播放列表', extensions: ['m3u', 'm3u8'] }],
      properties: ['openFile', 'dontAddToRecent']
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const file = result.filePaths[0]
    try {
      // The directory travels with the text so relative entries in the
      // playlist can be resolved by the renderer.
      return {
        name: path.basename(file, path.extname(file)),
        dir: path.dirname(file),
        text: decodeText(await fs.promises.readFile(file))
      }
    } catch (error) {
      console.error('[aurora] could not read the playlist', error)
      return null
    }
  })

  ipcMain.handle('playlists:export', async (_event, payload: { name: string; text: string }) => {
    const window = deps.window()
    if (!window || typeof payload?.text !== 'string') return false
    const safeName = (payload.name || 'playlist').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
    const result = await dialog.showSaveDialog(window, {
      title: '导出 m3u 播放列表',
      defaultPath: `${safeName}.m3u`,
      filters: [{ name: '播放列表', extensions: ['m3u'] }]
    })
    if (result.canceled || !result.filePath) return false
    try {
      await fs.promises.writeFile(result.filePath, payload.text, 'utf8')
      return true
    } catch (error) {
      console.error('[aurora] could not write the playlist', error)
      return false
    }
  })

  ipcMain.handle('library:scan', async () => {
    const controller: ScanControl = { cancelled: false }
    deps.setScan(controller)
    try {
      return await scanLibrary({
        cancelled: () => controller.cancelled,
        // Progress is advisory; a closed window must not fail the scan. It is
        // coalesced in `scan-progress` because one message per file would wake
        // the whole renderer for every file in the library.
        onProgress: (progress: ScanProgress) => sendProgress(progress)
      })
    } finally {
      if (deps.scan() === controller) deps.setScan(null)
    }
  })

  ipcMain.handle('library:cancelScan', () => {
    const scan = deps.scan()
    if (scan) scan.cancelled = true
    return true
  })
}
