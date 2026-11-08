import { ipcMain } from 'electron'
import {
  cancelDownload,
  clearDownloads,
  downloadPrefs,
  enqueueDownload,
  listDownloads,
  openDownloadFolder,
  pickDownloadFolder,
  revealDownload,
  setDownloadPrefs,
  type DownloadFormat,
  type DownloadRequest
} from '../downloads'

/**
 * The download surface.
 *
 * Every call is a plain command: the queue lives in the main process, so the
 * renderer never owns a half-downloaded file and a closed window cannot leave
 * one behind by accident.
 */
export function registerDownloadsIpc(): void {
  ipcMain.handle('downloads:enqueue', (_event, request: DownloadRequest) => enqueueDownload(request))
  ipcMain.handle('downloads:cancel', (_event, id: string) => cancelDownload(id))
  ipcMain.handle('downloads:list', () => listDownloads())
  ipcMain.handle('downloads:clear', () => clearDownloads())
  ipcMain.handle('downloads:reveal', (_event, id: string) => revealDownload(id))
  ipcMain.handle('downloads:openFolder', () => openDownloadFolder())
  ipcMain.handle('downloads:getPrefs', () => downloadPrefs())
  ipcMain.handle(
    'downloads:setPrefs',
    (_event, patch: { dir?: string; format?: DownloadFormat; bitrate?: number }) =>
      setDownloadPrefs(patch)
  )
  ipcMain.handle('downloads:pickFolder', () => pickDownloadFolder())
}
