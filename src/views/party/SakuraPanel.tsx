import { useState } from 'react'
import { useParty } from '../../features/party/store'

/**
 * 樱花隧道：一页。
 *
 * 仿官方启动器——一条隧道一张卡（ID / 节点 / 映射 / 开关），要手填的只有两样：
 * frpc 在哪、账号的访问密钥。房间跟着隧道走：隧道里的本地端口写死在服务端，
 * 改它要动用户配置；房间是自己的，让它监听那个端口，两边天然对上。
 */

interface Tunnel {
  id: number
  name: string
  node: string
  type: string
  localPort: number
  remotePort: number
  online: boolean
}

const KEYS = {
  frpc: 'aurora.party.frpc',
  token: 'aurora.party.token',
  tunnel: 'aurora.party.tunnel',
  port: 'aurora.party.port'
}

export function SakuraPanel() {
  const tunnel = useParty((store) => store.tunnel)
  const state = useParty((store) => store.state)
  const [frpc, setFrpc] = useState(() => localStorage.getItem(KEYS.frpc) ?? '')
  const [token, setToken] = useState(() => localStorage.getItem(KEYS.token) ?? '')
  const [tunnelId, setTunnelId] = useState(() => localStorage.getItem(KEYS.tunnel) ?? '')
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [note, setNote] = useState('')

  const roomPort = state.address.includes(':') ? state.address.slice(state.address.lastIndexOf(':') + 1) : ''

  const persist = (): void => {
    localStorage.setItem(KEYS.frpc, frpc)
    localStorage.setItem(KEYS.token, token)
  }

  const load = async (): Promise<void> => {
    persist()
    setNote('正在拉取…')
    const result = await window.aurora?.party?.sakuraTunnels(token)
    if (!result) {
      setNote('桌面版才有隧道列表')
      return
    }
    setTunnels(result.tunnels as Tunnel[])
    setNote(result.ok ? (result.tunnels.length ? '' : '这个账号还没有隧道') : result.message)
  }

  const toggle = async (item: Tunnel): Promise<void> => {
    if (tunnel.running) {
      await useParty.getState().stopTunnel()
      return
    }
    persist()
    if (item.localPort) {
      localStorage.setItem(KEYS.port, String(item.localPort))
      if (state.role !== 'idle') await useParty.getState().host('房主')
    }
    setTunnelId(String(item.id))
    localStorage.setItem(KEYS.tunnel, String(item.id))
    await useParty.getState().startTunnel({ frpcPath: frpc, token, tunnelId: String(item.id) })
  }

  return (
    <div className="sakura-panel">
      <div className="sakura-fields">
        <label className="party__field">
          <span>frpc 路径</span>
          <input
            className="input"
            placeholder="面板「软件下载」里那个独立版"
            value={frpc}
            onChange={(event) => setFrpc(event.target.value)}
          />
        </label>
        <label className="party__field">
          <span>访问密钥</span>
          <input
            className="input"
            placeholder="只存在这台机器上"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
      </div>

      <div className="sakura-head">
        <h3 className="party__section">隧道</h3>
        <button className="rh-btn" type="button" onClick={() => void load()}>
          拉取列表
        </button>
      </div>
      {note ? <p className="party__hint">{note}</p> : null}

      {tunnels.length ? (
        <ul className="sakura-list">
          {tunnels.map((item) => (
            <li key={item.id} className={'sakura-card' + (item.online ? ' is-on' : '')}>
              <span className="sakura-card__id">{item.id}</span>
              <span className="sakura-card__node">{item.node || '—'}</span>
              <span className="sakura-card__map">
                {item.type.toUpperCase()} {item.remotePort} → 127.0.0.1:{item.localPort}
              </span>
              {item.localPort && roomPort && String(item.localPort) !== roomPort ? (
                <span className="sakura-card__warn">
                  房间现在在 {roomPort}，点开这条会把房间改到 {item.localPort} 再穿出去
                </span>
              ) : null}
              <button
                className={'sakura-toggle' + (tunnel.running && tunnelId === String(item.id) ? ' is-on' : '')}
                type="button"
                aria-label="启停隧道"
                title={tunnel.running && tunnelId === String(item.id) ? '停掉这条' : '用这条把房间开到公网'}
                onClick={() => void toggle(item)}
              >
                <span className="sakura-toggle__knob" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="party__hint">
        需要一个樱花账号：登录后建一条 <b>TCP</b> 隧道，本地地址填{' '}
        <code>127.0.0.1:{roomPort || '房间端口'}</code>。
      </p>
      <button
        className="rh-btn"
        type="button"
        onClick={() => void window.aurora?.app?.openExternal('https://www.natfrp.com/user/')}
      >
        打开樱花面板（注册 / 登录 / 建隧道）
      </button>

      {tunnel.address ? <p className="party__hint">隧道已通：{tunnel.address}</p> : null}
      {!tunnel.address && tunnel.line ? <p className="party__hint">{tunnel.line}</p> : null}
      {tunnel.error ? <p className="party__hint">{tunnel.error}</p> : null}
    </div>
  )
}
