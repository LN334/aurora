import { useEffect, useState } from 'react'
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
  /* 建隧道：节点列表要现拉，名字与端口在这里填。 */
  const [creating, setCreating] = useState(false)
  const [nodes, setNodes] = useState<{ id: number; name: string; vip: number }[]>([])
  const [newName, setNewName] = useState('Aurora 一起听')
  const [newNode, setNewNode] = useState(0)
  const [newPort, setNewPort] = useState('')
  const [note, setNote] = useState('')
  /* 首次填密钥：只在没有密钥时出现，存进去之后这个框就不再出来。 */
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const roomPort = state.address.includes(':') ? state.address.slice(state.address.lastIndexOf(':') + 1) : ''

  /*
   * 打开这一页就自己去拉：让用户先点一次「拉取」是多余的一步——密钥已经交代过
   * 了，剩下的就是等结果。按钮留着当刷新用。
   */
  /* frpc 与密钥都自己找：不给用户留空要填。 */
  useEffect(() => {
    void window.aurora?.party?.sakuraFrpc().then((found) => {
      if (!found) return
      setFrpc(found)
      localStorage.setItem(KEYS.frpc, found)
    })
    if (token.trim()) void load()
    // 只在进页面时拉一次，之后靠刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = (): void => {
    localStorage.setItem(KEYS.frpc, frpc)
    localStorage.setItem(KEYS.token, token)
  }

  /**
   * 保存访问密钥。
   *
   * 原本想做「登录完自动带回来」，但樱花走 Nyatwork OpenID，登录发生在另一个
   * 域名，跳回面板后还得点「复制访问密钥」再读剪贴板——这条链一直没跑通。
   * 降级成「填一次」：粘贴一次、存本机、之后永不再问。访问密钥本来就是给人
   * 复制粘贴用的，一次性成本换掉整个不确定性。
   */
  const saveToken = (): void => {
    const value = draft.trim()
    if (!value) {
      setNote('密钥是空的')
      return
    }
    setToken(value)
    localStorage.setItem(KEYS.token, value)
    setEditing(false)
    setDraft('')
    setNote('已保存，正在拉隧道列表')
    void load()
  }



  const openCreate = async (): Promise<void> => {
    setCreating(true)
    if (nodes.length || !token.trim()) return
    setNote('正在拉节点…')
    const result = await window.aurora?.party?.sakuraNodes(token)
    if (!result || !result.ok) {
      setNote(result?.message ?? '节点列表拉不到')
      return
    }
    setNodes(result.nodes)
    setNewNode(result.nodes[0]?.id ?? 0)
    setNote('')
  }

  const createTunnel = async (): Promise<void> => {
    if (!newName.trim() || !newNode) {
      setNote('名字和节点都要填')
      return
    }
    const result = await window.aurora?.party?.sakuraCreate({
      token,
      name: newName.trim(),
      node: newNode,
      localPort: Number(newPort) || Number(roomPort) || 0
    })
    if (!result || !result.ok) {
      setNote(result?.message ?? '建不了')
      return
    }
    setCreating(false)
    setNote('隧道已建好，正在刷新列表')
    await load()
  }

  const load = async (): Promise<void> => {
    persist()
    setNote('正在拉取…')
    try {
      const result = await window.aurora?.party?.sakuraTunnels(token)
      if (!result) {
        setNote('桌面版才有隧道列表')
        return
      }
      setTunnels(result.tunnels as Tunnel[])
      setNote(result.ok ? (result.tunnels.length ? '' : '这个账号还没有隧道') : result.message)
    } catch (error) {
      /* 不许永远停在「正在拉取」：拉不到也要给一句人话。 */
      setNote('拉取失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const toggle = async (item: Tunnel): Promise<void> => {
    if (tunnel.running) {
      await useParty.getState().stopTunnel()
      return
    }
    persist()
    if (item.localPort) {
      /*
       * 改端口会重开房间，房间里的人会被踢下线。房间有人时不替用户做这个决定：
       * 先把话说明白，让他自己选「等房间空了再开」还是「先让人走」。
       */
      const occupied = state.role !== 'idle' && state.members.length > 1
      if (occupied) {
        setNote('房间里还有 ' + (state.members.length - 1) + ' 位听众，改端口会让他们掉线。等房间空了再开这条隧道。')
        return
      }
      localStorage.setItem(KEYS.port, String(item.localPort))
      if (state.role !== 'idle') await useParty.getState().host('房主')
    }
    setTunnelId(String(item.id))
    localStorage.setItem(KEYS.tunnel, String(item.id))
    await useParty.getState().startTunnel({ frpcPath: frpc, token, tunnelId: String(item.id) })
  }

  return (
    <div className="sakura-panel">
      {/*
        顺序照官方启动器：先有账号与隧道，才谈得上填路径、选隧道。说明放在最
        上面一颗按钮旁边，读者第一眼就知道这一步要去哪。
      */}
      <div className="sakura-first">
        <span className="sakura-first__state">
          {token ? '密钥已配置' : '还没有访问密钥'}
          {' · '}
          {frpc ? 'frpc 已找到' : 'frpc 没找到'}
        </span>
        {token && !editing ? (
          <button className="rh-btn" type="button" onClick={() => setEditing(true)}>
            重新填写
          </button>
        ) : null}
      </div>

      {/*
        只出现一次的输入：没有密钥、或者点了「重新填写」时才有。存进去之后就只剩
        上面那行状态——不让同一个东西反复挡在脸上。
      */}
      {!token || editing ? (
        <div className="sakura-setup">
          <label className="party__field">
            <span>访问密钥</span>
            <input
              className="input"
              placeholder="樱花面板 · 账号设置里复制来的那一串"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveToken()
              }}
            />
          </label>
          <button className="rh-btn rh-btn--main" type="button" onClick={saveToken}>
            保存
          </button>
          <button
            className="rh-btn"
            type="button"
            onClick={() => void window.aurora?.app?.openExternal('https://www.natfrp.com/user/')}
          >
            去面板复制
          </button>
        </div>
      ) : null}


      <div className="sakura-head">
        <h3 className="party__section">隧道</h3>
        <button className="rh-btn" type="button" onClick={() => void openCreate()}>
          新建
        </button>
        <button className="rh-btn" type="button" onClick={() => void load()}>
          刷新
        </button>
      </div>

      {/*
        建隧道：名字、节点、本地端口。端口默认取房间正在听的那个，建完点卡片开关
        就能直接穿出去——不用先回来改一遍端口。
      */}
      {creating ? (
        <div className="sakura-create">
          <label className="party__field">
            <span>名字</span>
            <input className="input" value={newName} onChange={(event) => setNewName(event.target.value)} />
          </label>
          <label className="party__field">
            <span>节点</span>
            <select
              className="input"
              value={newNode}
              onChange={(event) => setNewNode(Number(event.target.value))}
            >
              {nodes.length === 0 ? <option value={0}>正在拉…</option> : null}
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                  {node.vip > 0 ? '（VIP）' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="party__field">
            <span>本地端口</span>
            <input
              className="input"
              placeholder={roomPort || '房间端口'}
              value={newPort}
              inputMode="numeric"
              onChange={(event) => setNewPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
            />
          </label>
          <button className="rh-btn rh-btn--main" type="button" onClick={() => void createTunnel()}>
            创建隧道
          </button>
          <button className="rh-btn" type="button" onClick={() => setCreating(false)}>
            取消
          </button>
        </div>
      ) : null}
      {note ? <p className="party__hint">{note}</p> : null}

      {tunnels.length ? (
        <ul className="sakura-list">
          {tunnels.map((item) => (
            <li key={item.id} className={'sakura-card' + (item.online ? ' is-on' : '')}>
              {/* 隧道名当标题：官方启动器那张卡最上面就是它，id 退成角标。 */}
              <span className="sakura-card__name">{item.name || '未命名隧道'}</span>
              <span className="sakura-card__id">#{item.id}</span>
              {/* 接口里 node 是节点 id（数字），不是名字，照原样标成「节点 47」比印个裸数字清楚。 */}
              <span className="sakura-card__node">{item.node ? '节点 ' + item.node : '—'}</span>
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

      {tunnel.address ? <p className="party__hint">隧道已通：{tunnel.address}</p> : null}
      {!tunnel.address && tunnel.line ? <p className="party__hint">{tunnel.line}</p> : null}
      {tunnel.error ? <p className="party__hint">{tunnel.error}</p> : null}
    </div>
  )
}
