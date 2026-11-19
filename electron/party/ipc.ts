import { BrowserWindow, ipcMain } from 'electron'
import { joinParty, onPartyState, partyState, pushNow, startHost, stopParty } from './room'
import type { PartyNow } from './room'

/**
 * 一起听的 IPC。
 *
 * 状态从主进程往渲染层推（房间成员随时变），命令从渲染层往下发。所有通道都
 * resolve，理由同另外几处：界面把每一次调用都写成「可能失败」，抛异常只会
 * 变成一处没人 catch 的未处理拒绝。
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 广播到所有窗口：桌面歌词窗也开着一份，状态要一致。 */
function broadcast(state: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('party:state', state)
  }
}

export function registerPartyIpc(): void {
  onPartyState(broadcast)

  ipcMain.handle('party:host', (_event, args: unknown) => {
    const name = asText(asRecord(args).name, '房主').slice(0, 24) || '房主'
    return startHost(name)
  })

  ipcMain.handle('party:join', (_event, args: unknown) => {
    const raw = asRecord(args)
    return joinParty(asText(raw.address), asText(raw.code), asText(raw.name, '听众'))
  })

  ipcMain.handle('party:leave', () => {
    stopParty()
    return partyState()
  })

  ipcMain.handle('party:now', (_event, args: unknown) => {
    const raw = asRecord(args)
    const now = raw.now as PartyNow | undefined
    if (now && typeof now.trackId === 'string') pushNow(now)
    return partyState()
  })

  ipcMain.handle('party:state', () => partyState())
}
