import { useEffect, useState } from 'react'
import { useParty } from '../features/party/store'
import { Close, User } from '../ui/icons'
import { usePresence } from '../ui/presence'

/**
 * 一起听面板。
 *
 * 房间开在本机进程里：房主这边显示「地址 + 6 位码」，同一 WiFi 下的人在自己
 * 面板里填这两样进来。同步的是「听什么、听到哪」，不是音频本体——每台机器
 * 各自取流，所以房间里的人都得能听到同一首歌（同一平台、同一账号权限）。
 *
 * 消息也走同一条连接：谁说了什么由房主那边记账再广播，客人不等本地回显，
 * 免得同一条话走两条路回来变成两句。
 */

/** 消息旁边的时间：只到分钟，一天之内够用了。 */

export function PartyPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const { mounted, closing } = usePresence(open, 320)
  const state = useParty((s) => s.state)
  const busy = useParty((s) => s.busy)
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [publicDraft, setPublicDraft] = useState('')
  /*
   * 樱花隧道的三个值记在本机：它们属于「这台机器怎么开房」，不是房间状态。
   * frpc 路径指向官方独立分发版——启动器目录里那份只允许 SakuraFrp Service 调。
   */
  const [portDraft, setPortDraft] = useState(() => localStorage.getItem('aurora.party.port') ?? '')
  const [note, setNote] = useState('')
  /*
   * 隧道列表：仿照官方启动器，一张卡一条。数据用访问密钥现拉，不缓存——隧道
   * 的在线状态随时会变。
   */

  useEffect(() => {
    if (open) useParty.getState().init()
  }, [open])

  // 房间里的公网地址可能被房主改，输入框跟着同步一次。
  useEffect(() => {
    setPublicDraft(state.publicAddress)
  }, [state.publicAddress])

  if (!mounted) return null

  const inRoom = state.role !== 'idle'

  /**
   * 把「地址 + 房间码」一次复制走。
   *
   * 房主要发给别人的是两条信息，手抄一遍就容易抄错一位。优先用公网地址：
   * 房主填了它，说明这一趟就是想跨网络；没填才退回局域网地址。
   */
  const copyInvite = async (): Promise<void> => {
    const place = state.publicAddress || state.address
    if (!place) {
      setNote('还没有可用的地址')
      return
    }
    try {
      await navigator.clipboard.writeText('一起听：' + place + '\n房间码：' + state.code)
      setNote('已复制，发给朋友就行')
    } catch {
      setNote('复制失败，剪贴板不可用')
    }
  }

  /**
   * 公网地址存之前先洗一遍。
   *
   * 有人会把 `ws://`、`https://` 前缀一起粘进来；也有人用的是自带域名的隧道，
   * 地址里根本没有端口（`xxx.trycloudflare.com`）。两种都收，只把形状不对的拒掉。
   */
  const savePublic = async (): Promise<void> => {
    const clean = publicDraft
      .trim()
      .replace(/^wss?:\/\//i, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
    if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(clean)) {
      setNote('公网地址要写成 host 或 host:端口，例如 xxx.natfrp.cloud:23456')
      return
    }
    await useParty.getState().setPublic(clean)
    setNote('公网地址已更新，房间里的人都看得到')
  }

  /** 房间监听的端口；樱花隧道要指向它。 */
  const roomPort = state.address.includes(':') ? state.address.slice(state.address.lastIndexOf(':') + 1) : ''


  return (
    <aside className={`party-dialog${closing ? ' is-closing' : ''}`} aria-label="一起听">
      <header className="panel__head">
        <h2 className="panel__title">一起听</h2>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭一起听">
          <Close size={16} />
        </button>
      </header>

      {!inRoom ? (
        <div className="panel__body party__setup">
          {/*
            左右两栏：左边你来开房，右边去别人那里。原来两者竖着叠在一列里，
            按钮长得一样重，「我到底是开还是进」得读完两段字才知道。
          */}
          <section className="party__col">
            <h3 className="party__col-title">开一个房间</h3>
            <label className="party__field">
              <span>房间端口</span>
              <input
                className="input"
                placeholder="留空则随机"
                value={portDraft}
                inputMode="numeric"
                onChange={(event) => setPortDraft(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
              />
            </label>
            <p className="party__hint">
              固定端口后，樱花隧道里那个「本地端口」只配一次。同一 WiFi 用「局域网地址 + 房间码」进，跨网络要先把端口穿到公网。
            </p>
            <button
              className="rh-btn rh-btn--main"
              disabled={busy}
              onClick={() => {
                const value = Number(portDraft)
                if (portDraft && value > 1024 && value < 65536) {
                  localStorage.setItem('aurora.party.port', String(value))
                } else {
                  localStorage.removeItem('aurora.party.port')
                }
                void useParty.getState().host('房主')
              }}
            >
              <User size={15} />
              开一个房间
            </button>
          </section>

          <section className="party__col">
            <h3 className="party__col-title">加入朋友的房间</h3>
            <label className="party__field">
              <span>房主的地址</span>
              <input
                className="input"
                placeholder="192.168.1.5:7890 或 xxx.natfrp.cloud:23456"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
            <label className="party__field">
              <span>房间码</span>
              <input
                className="input"
                placeholder="6 位"
                value={code}
                maxLength={6}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </label>
            <button
              className="rh-btn rh-btn--main"
              disabled={busy || !address.trim() || code.trim().length !== 6}
              onClick={() => void useParty.getState().join(address, code, '听众')}
            >
              加入
            </button>
          </section>
          {state.error ? <p className="pg-note">{state.error}</p> : null}
        </div>
      ) : (
        <div className="panel__body">
          <div className="party__room-grid">
            <section className="party__col">
          <dl className="party__facts">
            <dt>房间码</dt>
            <dd>{state.code || '—'}</dd>
            <dt>局域网</dt>
            <dd>
              {/*
                多网卡（VPN、虚拟机、第二个网卡）时第一个未必是客人能到的那个，
                房主看到全部候选，挑一个发出去。
              */}
              {state.role === 'host' && state.addresses.length > 1
                ? state.addresses.join(' · ')
                : state.address || '—'}
            </dd>
            <dt>端口</dt>
            <dd>{roomPort || '—'}</dd>
            <dt>公网</dt>
            <dd>{state.publicAddress || '—'}</dd>
          </dl>

          {/*
            公网入口要房主自己开：内网穿透工具的客户端不让别的程序代它启动，
            Aurora 只能把隧道给的地址收进来，再显示给房间里所有人。
          */}
          {state.role === 'host' ? (
            <div className="party__public">
              <input
                className="input"
                placeholder="公网地址，如 xxx.natfrp.cloud:23456"
                value={publicDraft}
                onChange={(event) => setPublicDraft(event.target.value)}
              />
              <button
                className="rh-btn"
                disabled={publicDraft.trim() === state.publicAddress}
                onClick={() => void savePublic()}
              >
                保存
              </button>
            </div>
          ) : null}

          <button className="rh-btn" onClick={() => void copyInvite()}>
            复制邀请（地址 + 房间码）
          </button>

          {/*
            转发就是「客人听到的和你一样」。关掉之后两边各取各的，客人没账号
            就听不到——所以这里把它写成一个明确的取舍，而不是藏在设置里。
          */}
          {state.role === 'host' ? (
            <label className="party__relay">
              <input
                type="checkbox"
                checked={state.relay}
                onChange={(event) => void useParty.getState().setRelay(event.target.checked)}
              />
              <span>替房间转发音频（客人不用登录也能听同一档）</span>
            </label>
          ) : null}

          {/*
            樱花隧道。只对房主显示：客人不需要自己开隧道。
            用的是官方独立分发的 frpc（面板「软件下载」里那个），启动参数是
            官方的 -f 访问密钥:隧道ID。
          */}
          {state.role === 'host' ? (
            <button
              className="rh-btn"
              type="button"
              onClick={() => void window.aurora?.party?.openSakura()}
            >
              樱花隧道…
            </button>
          ) : null}

            </section>
            <section className="party__col">
          <dl className="party__facts">
            <dt>成员</dt>
            <dd>{state.members.map((member) => member.name).join('、') || '—'}</dd>
            <dt>现在</dt>
            <dd>
              {state.now ? state.now.title + ' — ' + state.now.artist : '还没同步'}
              {/* 房主带了地址过来时，这一首听到的是他那一档，不是自己账号的。 */}
              {state.now?.stream ? (
                <span className="party__src">
                  {' · 音质由房主提供'}
                  {state.now.stream.quality ? `（${state.now.stream.quality}` : '（'}
                  {state.now.stream.via === 'relay' ? '，经房间转发' : '，平台直链'}
                  {'）'}
                </span>
              ) : null}
            </dd>
          </dl>
          {/* 聊天搬去自己的窗口：它和房间信息不是一类东西，挤在一起两边都不好用。 */}
          <button
            className="rh-btn"
            type="button"
            onClick={() => void window.aurora?.party?.openChat()}
          >
            打开聊天室
          </button>


            </section>
          </div>
          <button className="rh-btn" onClick={() => void useParty.getState().leave()}>
            离开房间
          </button>
          {note ? <p className="pg-note">{note}</p> : null}
          {state.error ? <p className="pg-note">{state.error}</p> : null}
        </div>
      )}
    </aside>
  )
}
