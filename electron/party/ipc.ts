import { BrowserWindow, ipcMain } from 'electron'
import { registerStream } from './room'
import { onTunnelState, startTunnel, stopTunnel, tunnelState } from './tunnel'
import {
  joinParty,
  onPartyState,
  partyState,
  pushNow,
  sendChat,
  setPublicAddress,
  startHost,
  stopParty
} from './room'
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

/** 隧道状态推给所有窗口：一起听面板与桌面歌词窗都可能开着。 */
function broadcastTunnel(state: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('party:tunnel', state)
  }
}

let tunnelWired = false
function onTunnelBroadcast(): void {
  if (tunnelWired) return
  tunnelWired = true
  onTunnelState(broadcastTunnel)
}

export function registerPartyIpc(): void {
  onPartyState(broadcast)

  /*
   * 樱花隧道：起的是官方独立分发的 frpc（`-f 密钥:隧道ID`），不是启动器安装目录
   * 里那份——那份被改成只允许 SakuraFrp Service 调用，裸跑直接退出。
   */
  ipcMain.handle('party:tunnelStart', (_event, args: unknown) => {
    const raw = asRecord(args)
    return startTunnel({
      frpcPath: asText(raw.frpcPath),
      token: asText(raw.token),
      tunnelId: asText(raw.tunnelId)
    })
  })

  ipcMain.handle('party:tunnelStop', () => {
    stopTunnel()
    return tunnelState()
  })

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

  ipcMain.handle('party:public', (_event, args: unknown) => {
    setPublicAddress(asText(asRecord(args).address))
    return partyState()
  })

  ipcMain.handle('party:chat', (_event, args: unknown) => {
    sendChat(asText(asRecord(args).text))
    return partyState()
  })

  /*
   * 房主取到流之后登记一份，客人就能从这条房间端口拉音频——平台看到的请求
   * 来自房主这台机器，不再受「地址认 IP」的限制。
   */
  ipcMain.handle('party:stream', (_event, args: unknown) => {
    const raw = asRecord(args)
    registerStream(asText(raw.trackId), asText(raw.url))
    return true
  })

  onTunnelBroadcast()

  ipcMain.handle('party:tunnelState', () => tunnelState())

  ipcMain.handle('party:state', () => partyState())
}
