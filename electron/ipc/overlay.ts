import { ipcMain } from 'electron'
import type { MediaCommand } from '../tray'
import {
  pushOverlayState,
  setHitArea as setOverlayHitArea,
  setLocked as setOverlayLocked,
  setLyricSize,
  status as overlayStatus,
  toggleOverlay,
  type OverlayState
} from '../lyrics-overlay'

const COMMANDS: readonly MediaCommand[] = ['toggle', 'next', 'prev']

/** 数字字段的信任边界：只收有限数，缺的按 null/0 处理。 */
function seconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function optionalSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null
}

/**
 * 桌面歌词窗的 IPC 入口：开关、锁定、命中框、歌词推送，以及把工具条上的
 * 播放命令转回主窗。
 *
 * `sendCommand` 就是托盘和任务栏缩略图按钮在用的那条通道，桌面歌词不另开
 * 一套播放语义，免得三处的「上一首」行为慢慢长歪。
 */
export function registerOverlayIpc(sendCommand: (command: MediaCommand) => void): void {
  ipcMain.handle('overlay:toggle', (_event, enabled: unknown) =>
    toggleOverlay(typeof enabled === 'boolean' ? enabled : undefined)
  )

  ipcMain.handle('overlay:status', () => overlayStatus())

  ipcMain.handle('overlay:setLocked', (_event, locked: unknown) => setOverlayLocked(Boolean(locked)))

  // The strip reports where its words are; the main process polls the cursor
  // against that box so a locked window takes the mouse only over the lyrics.
  ipcMain.handle('overlay:hit-area', (_event, rect: unknown) => setOverlayHitArea(rect))

  ipcMain.handle('overlay:setSize', (_event, size: unknown) => setLyricSize(Number(size)))

  ipcMain.handle('overlay:close', () => {
    toggleOverlay(false)
    return overlayStatus()
  })

  ipcMain.handle('overlay:command', (_event, command: unknown) => {
    if (!COMMANDS.includes(command as MediaCommand)) return false
    sendCommand(command as MediaCommand)
    return true
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
      playing: Boolean(candidate.playing),
      at: optionalSeconds(candidate.at),
      to: optionalSeconds(candidate.to),
      position: seconds(candidate.position),
      duration: seconds(candidate.duration),
      accent: typeof candidate.accent === 'string' ? candidate.accent : ''
    })
    return true
  })
}
