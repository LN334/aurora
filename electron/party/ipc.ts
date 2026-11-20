import { BrowserWindow, ipcMain } from 'electron'
import { registerStream, setRelay } from './room'
import { sakuraCreateTunnel, sakuraEditTunnel, sakuraNodes, sakuraTunnels } from '../sakura/api'
import { sakuraLogin } from '../sakura/login'
import { sakuraFindFrpc } from '../sakura/frpc'
import { chatWindowOpen } from '../chat-window'
import { sakuraWindowOpen } from '../sakura-window'
import { partyWindowOpen } from '../party-window'
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
    const raw = asRecord(args)
    const name = asText(raw.name, '房主').slice(0, 24) || '房主'
    const wanted = Number(raw.port)
    const port = Number.isInteger(wanted) && wanted > 1024 && wanted < 65536 ? wanted : 0
    return startHost(name, port)
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
  /* 隧道列表：仿照官方启动器，用访问密钥换回那一列卡片的数据。 */
  ipcMain.handle('sakura:tunnels', async (_event, args: unknown) => {
    return await sakuraTunnels(asText(asRecord(args).token))
  })

  ipcMain.handle('sakura:nodes', async (_event, args: unknown) => {
    return await sakuraNodes(asText(asRecord(args).token))
  })

  ipcMain.handle('sakura:create', async (_event, args: unknown) => {
    const raw = asRecord(args)
    return await sakuraCreateTunnel(asText(raw.token), {
      name: asText(raw.name),
      node: Number(raw.node ?? 0),
      localPort: Number(raw.localPort ?? 0),
      remote: asText(raw.remote)
    })
  })

  ipcMain.handle('sakura:edit', async (_event, args: unknown) => {
    const raw = asRecord(args)
    return await sakuraEditTunnel(asText(raw.token), {
      id: Number(raw.id ?? 0),
      note: raw.note === undefined ? undefined : asText(raw.note),
      localPort: raw.localPort === undefined ? undefined : Number(raw.localPort)
    })
  })

  /* 登录樱花并直接拿回访问密钥：不让用户去网页里找到再粘过来。 */
  /* 找 frpc：不让用户填路径。 */
  ipcMain.handle('sakura:frpc', () => sakuraFindFrpc())

  ipcMain.handle('sakura:login', async () => {
    return await sakuraLogin()
  })

  ipcMain.handle('party:window', () => {
    partyWindowOpen()
    return true
  })

  ipcMain.handle('party:sakura', () => {
    sakuraWindowOpen()
    return true
  })

  ipcMain.handle('party:chatWindow', () => {
    chatWindowOpen()
    return true
  })

  ipcMain.handle('party:relay', (_event, args: unknown) => {
    setRelay(Boolean(asRecord(args).relay))
    return partyState()
  })

  ipcMain.handle('party:stream', (_event, args: unknown) => {
    const raw = asRecord(args)
    return registerStream(asText(raw.trackId), asText(raw.url))
  })

  onTunnelBroadcast()

  ipcMain.handle('party:tunnelState', () => tunnelState())

  ipcMain.handle('party:state', () => partyState())
}
