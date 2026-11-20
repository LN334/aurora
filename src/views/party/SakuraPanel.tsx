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
  /** 面板上给这条隧道起的备注；没有就是空串。 */
  note: string
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
  const [token, setToken] = useState(() => localStorage.getItem(KEYS.token) ?? '')
  const [tunnelId, setTunnelId] = useState(() => localStorage.getItem(KEYS.tunnel) ?? '')
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState('')
  /* 建隧道：节点列表要现拉，名字与端口在这里填。 */
  const [creating, setCreating] = useState(false)
  const [nodes, setNodes] = useState<{ id: number; name: string; vip: number; flag: number }[]>([])
  const [nodeQuery, setNodeQuery] = useState('')
  const [newName, setNewName] = useState('Aurora_Party')
  const [newNode, setNewNode] = useState(0)
  const [newPort, setNewPort] = useState('')
  /* 编辑：改一条隧道的本地端口，改完房间跟着挪过去。 */
  const [editingId, setEditingId] = useState(0)
  const [editPort, setEditPort] = useState('')
  /* 节点 id → 名字。拉一次存着；拉不到就照旧显示数字，不影响别的。 */
  const [nodeNames, setNodeNames] = useState<Record<number, string>>({})
  /*
   * frpc：找到 ≠ 能用。
   *
   * localStorage 里可能留着上一次那条路径，而那个文件早就没了（比如从启动器
   * 目录挪走的那份）。所以这一项只认「检查通过」：没通过就当没有，界面给出
   * 「装一份」的出口，不让用户对着一个灰开关猜。
   */
  const [frpc, setFrpc] = useState('')
  const [frpcReady, setFrpcReady] = useState(false)
  const [frpcNote, setFrpcNote] = useState('正在检查 frpc…')
  const [installing, setInstalling] = useState(false)
  /* 首次填密钥：只在没有密钥时出现，存进去之后这个框就不再出来。 */
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const roomPort = state.address.includes(':') ? state.address.slice(state.address.lastIndexOf(':') + 1) : ''

  /*
   * 打开这一页就自己去拉：让用户先点一次「拉取」是多余的一步——密钥已经交代过
   * 了，剩下的就是等结果。按钮留着当刷新用。
   */
  useEffect(() => {
    /* 节点名要现拉，拉不到不影响列表——卡片上退回显示 id。 */
    void loadNodeNames(localStorage.getItem(KEYS.token) ?? '')
    void window.aurora?.party?.sakuraFrpc().then((found) => {
      if (!found) {
        setFrpcNote('桌面版才能装 frpc')
        return
      }
      if (found.ok && found.path) {
        setFrpc(found.path)
        setFrpcReady(true)
        setFrpcNote('frpc 可用')
        localStorage.setItem(KEYS.frpc, found.path)
        return
      }
      /* 找到却跑不起来，或者根本没找到：本机那份不可信，留给「装 frpc」这条路。 */
      setFrpc('')
      setFrpcReady(false)
      localStorage.removeItem(KEYS.frpc)
      setFrpcNote(found.path ? found.message : '没找到 frpc')
    })
    const saved = localStorage.getItem(KEYS.token) ?? ''
    if (saved.trim()) void load(saved)
    // 只在进页面时拉一次，之后靠刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 保存访问密钥。
   *
   * 樱花走 Nyatwork OpenID，登录发生在另一个域名，跳回面板后还得点「复制访问
   * 密钥」再读剪贴板——那条链一直没跑通。降级成「填一次」：粘贴一次、存本机、
   * 之后永不再问。访问密钥本来就是给人复制粘贴用的，一次性成本换掉整个不确定性。
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
    /* 用刚保存的这一份去拉：state 要等下一次渲染才变，闭包里的 token 还是旧的。 */
    void load(value)
  }

  const installFrpc = async (): Promise<void> => {
    setInstalling(true)
    setFrpcNote('正在下载 frpc…')
    try {
      const result = await window.aurora?.party?.sakuraInstallFrpc()
      if (!result) {
        setFrpcNote('桌面版才能下载')
        return
      }
      if (result.ok) {
        setFrpc(result.path)
        setFrpcReady(true)
        localStorage.setItem(KEYS.frpc, result.path)
        setFrpcNote('frpc 已装好')
      } else {
        setFrpcReady(false)
        setFrpcNote(result.message)
      }
    } finally {
      setInstalling(false)
    }
  }

  /**
   * 节点 id → 名字。
   *
   * 单独抽出来是因为它有两次机会：进页面时一次，刷新列表成功后再一次。第一次
   * 赶上网络还没好，卡片就会一直显示「节点 47」这种数字，而列表其实早拉到了。
   */
  const loadNodeNames = async (withToken: string): Promise<void> => {
    const value = (withToken ?? token).trim()
    if (!value) return
    const result = await window.aurora?.party?.sakuraNodes(value)
    if (!result?.ok) return
    const map: Record<number, string> = {}
    for (const node of result.nodes) map[node.id] = node.name
    setNodeNames(map)
  }

  const reloadNodes = async (): Promise<void> => {
    if (!token.trim()) {
      setNote('先填访问密钥，节点列表要它才拉得到')
      return
    }
    setNote('正在拉节点…')
    const result = await window.aurora?.party?.sakuraNodes(token)
    if (!result || !result.ok) {
      setNote(result?.message ?? '节点列表拉不到')
      return
    }
    setNodes(result.nodes)
    if (!newNode && result.nodes[0]) setNewNode(result.nodes[0].id)
    setNote('')
  }

  const openCreate = async (): Promise<void> => {
    setCreating(true)
    if (nodes.length) return
    await reloadNodes()
  }

  /* 樱花对隧道名的要求是硬的：3~20 位，只能字母数字下划线。前端先拦一道，
     否则点下去只会拿回一句「不符合规范」，用户不知道该怎么改。 */
  const nameOk = /^[A-Za-z0-9_]{3,20}$/.test(newName.trim())

  const createTunnel = async (): Promise<void> => {
    if (!nameOk || !newNode) {
      setNote('名字要 3~20 位，只能用字母、数字、下划线')
      return
    }
    const port = Number(newPort) || Number(roomPort) || 0
    if (!port) {
      setNote('先开一个房间，或者在这里填上本地端口')
      return
    }
    if (port > 65535) {
      setNote('端口要在 1~65535 之间')
      return
    }
    const result = await window.aurora?.party?.sakuraCreate({
      token,
      name: newName.trim(),
      node: newNode,
      localPort: port
    })
    if (!result || !result.ok) {
      setNote(result?.message ?? '建不了')
      return
    }
    setCreating(false)
    setNote('隧道已建好，正在刷新列表')
    await load()
  }

  const saveEdit = async (id: number): Promise<void> => {
    const port = Number(editPort)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setNote('端口要是 1~65535 之间的数字')
      return
    }
    const result = await window.aurora?.party?.sakuraEdit({ token, id, localPort: port })
    if (!result || !result.ok) {
      setNote(result?.message ?? '改不动')
      return
    }
    setEditingId(0)
    setNote('已改成本地端口 ' + port)
    await load()
  }

  /**
   * 拉隧道列表。`withToken` 是刚保存、还没进 state 的那份密钥。
   *
   * 失败时不清空已有列表：网抖一下不该让卡片「消失」，那会让人以为隧道没了。
   */
  const load = async (withToken?: string): Promise<void> => {
    const value = (withToken ?? token).trim()
    localStorage.setItem(KEYS.token, value)
    if (!value) {
      setTunnels([])
      setNote('还没有访问密钥')
      return
    }
    setLoading(true)
    setNote('正在拉取…')
    try {
      const result = await window.aurora?.party?.sakuraTunnels(value)
      if (!result) {
        setNote('桌面版才有隧道列表')
        return
      }
      if (result.ok) {
        setTunnels(result.tunnels as Tunnel[])
        setNote('')
        /* 名字可能上次没拉到：列表既然通了，就顺手补一次。 */
        if (!Object.keys(nodeNames).length) void loadNodeNames(value)
      } else {
        setNote(result.message)
      }
    } catch (error) {
      /* 不许永远停在「正在拉取」：拉不到也要给一句人话。 */
      setNote('拉取失败：' + (error instanceof Error ? error.message : String(error)))
    } finally {
      setLoading(false)
    }
  }

  const toggle = async (item: Tunnel): Promise<void> => {
    const active = tunnel.running && tunnelId === String(item.id)
    if (active) {
      await useParty.getState().stopTunnel()
      return
    }
    if (!frpcReady) {
      setNote('先装一份 frpc：没有它隧道起不来')
      return
    }
    /*
     * 另一条在跑：先停它再起这一条。只停不换的话，用户点了第二条看到的是
     * 「灯灭了但也没通」——他不知道那是另一条被停了。
     */
    if (tunnel.running) await useParty.getState().stopTunnel()
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

  const copyAddress = async (): Promise<void> => {
    const value = tunnel.address
    if (!value) return
    /* 走主进程写剪贴板：页面里的 navigator.clipboard 在 aurora-app:// 下不是安全上下文，写不进去。 */
    const done = await window.aurora?.app?.copy(value)
    setNote(done ? '地址已复制：' + value : value)
  }

  /*
   * 节点有七十多个，下拉里一个个找太费劲。输入框只做一件事：按名字过滤。
   * 已经选中的那个节点要留在列表里，否则过滤一输入，选择就跳回第一项。
   */
  const visibleNodes = ((): typeof nodes => {
    const query = nodeQuery.trim()
    const list = query ? nodes.filter((node) => node.name.includes(query) || String(node.id) === query) : nodes
    if (newNode && !list.some((node) => node.id === newNode)) {
      const picked = nodes.find((node) => node.id === newNode)
      if (picked) return [picked, ...list]
    }
    return list
  })()

  return (
    <div className="sakura-panel">
      {/*
        顺序照官方启动器：先有账号与隧道，才谈得上选隧道。两件事各一颗灯，
        缺哪一件就在旁边给出口——不让人对着一句「没找到 frpc」发愣。
      */}
      <div className="sakura-first">
        <span className="sakura-first__state">
          <i className={'party__lamp' + (token ? ' is-on' : '')} />
          密钥{token ? '已配置' : '还没填'}
        </span>
        <span className="sakura-first__state">
          {/* 缺 frpc 用琥珀色那颗灯：颜色已经在别处代表「有事要办」，不再另发明一种。 */}
          <i className={'party__lamp' + (frpcReady ? ' is-on' : ' is-busy')} />
          {frpcNote}
        </span>
        <span className="sakura-first__grow" />
        {!frpcReady ? (
          <button className="rh-btn rh-btn--main" type="button" disabled={installing} onClick={() => void installFrpc()}>
            {installing ? '下载中…' : '装 frpc'}
          </button>
        ) : null}
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
        {tunnels.length ? <span className="sakura-head__count">{tunnels.length}</span> : null}
        <span className="sakura-first__grow" />
        <button className="rh-btn" type="button" onClick={() => void openCreate()}>
          新建
        </button>
        <button className="rh-btn" type="button" disabled={loading} onClick={() => void load()}>
          {loading ? '刷新中…' : '刷新'}
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
            <input
              className="input"
              value={newName}
              placeholder="3~20 位字母数字下划线"
              onChange={(event) => setNewName(event.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 20))}
            />
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
          <div className="party__field sakura-create__wide">
            <span>节点</span>
            <div className="sakura-nodes">
              <input
                className="input"
                value={nodeQuery}
                placeholder="按名字找节点"
                onChange={(event) => setNodeQuery(event.target.value)}
              />
              <select
                className="input"
                value={newNode}
                onChange={(event) => setNewNode(Number(event.target.value))}
              >
                {visibleNodes.length === 0 ? <option value={0}>没有匹配的节点</option> : null}
                {visibleNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                    {node.vip > 0 ? '（VIP）' : ''}
                  </option>
                ))}
              </select>
            </div>
            <span className="sakura-create__hint">节点是樱花那边的线路，选离自己近的；VIP 节点要会员</span>
          </div>
          <div className="sakura-create__actions">
            <button className="rh-btn rh-btn--main" type="button" disabled={!nameOk || !newNode} onClick={() => void createTunnel()}>
              创建隧道
            </button>
            {nodes.length === 0 ? (
              <button className="rh-btn" type="button" onClick={() => void reloadNodes()}>
                重拉节点
              </button>
            ) : null}
            <button className="rh-btn" type="button" onClick={() => setCreating(false)}>
              取消
            </button>
          </div>
        </div>
      ) : null}
      {note ? <p className="party__hint">{note}</p> : null}

      {tunnels.length ? (
        <ul className="sakura-list">
          {tunnels.map((item) => (
            <li key={item.id} className={'sakura-card' + (item.online ? ' is-on' : '')}>
              {/* 隧道名当标题：官方启动器那张卡最上面就是它，id 退成角标。 */}
              <span className="sakura-card__name">
                <i className={'party__lamp' + (item.online ? ' is-on' : '')} />
                {item.name || '未命名隧道'}
              </span>
              <span className="sakura-card__id">#{item.id}</span>
              {/* 接口里 node 是节点 id（数字），不是名字，照原样标成「节点 47」比印个裸数字清楚。 */}
              <span className="sakura-card__node">
                {nodeNames[Number(item.node)] ?? (item.node ? '节点 ' + item.node : '—')}
              </span>
              {item.note ? <span className="sakura-card__note">{item.note}</span> : null}
              <span className="sakura-card__map">
                {item.type.toUpperCase()} {item.remotePort} → 127.0.0.1:{item.localPort}
              </span>
              {editingId === item.id ? (
                <span className="sakura-card__edit">
                  <input
                    className="input"
                    value={editPort}
                    inputMode="numeric"
                    placeholder={String(item.localPort)}
                    onChange={(event) => setEditPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                  />
                  <button className="rh-btn" type="button" onClick={() => void saveEdit(item.id)}>
                    保存
                  </button>
                  <button className="rh-btn" type="button" onClick={() => setEditingId(0)}>
                    取消
                  </button>
                </span>
              ) : (
                <button
                  className="sakura-card__act"
                  type="button"
                  onClick={() => {
                    setEditingId(item.id)
                    setEditPort(String(item.localPort || ''))
                  }}
                >
                  改本地端口
                </button>
              )}
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

      {/* 拉到空列表：给下一步，而不是一行「还没有隧道」让人回房间页自己猜。 */}
      {!tunnels.length && !loading && token && !note ? (
        <div className="sakura-empty">
          <strong>这个账号还没有隧道</strong>
          <span>建一条 TCP 隧道，本地端口填房间端口；建好点卡片上的开关就能穿出去。</span>
          <button className="rh-btn rh-btn--main" type="button" onClick={() => void openCreate()}>
            建一条
          </button>
        </div>
      ) : null}

      {tunnel.address ? (
        <p className="party__hint sakura-live">
          <i className="party__lamp is-on" />
          <span>隧道已通：{tunnel.address}</span>
          <button className="rh-btn" type="button" onClick={() => void copyAddress()}>
            复制地址
          </button>
        </p>
      ) : null}
      {!tunnel.address && tunnel.line ? <p className="party__hint">{tunnel.line}</p> : null}
      {tunnel.error ? <p className="party__hint">{tunnel.error}</p> : null}
    </div>
  )
}
