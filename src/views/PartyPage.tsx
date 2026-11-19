import { useEffect, useState } from 'react'
import { useParty } from '../features/party/store'
import { usePresence } from '../ui/presence'

/**
 * 一起听：一页。
 *
 * 不是弹窗、不是窗口。这一页占满内容区，左边做事、右边看房间，页头由外壳打。
 * 房间本身活在主进程里：离开这一页不等于退房，回来还在同一个房间里。
 */

const SIX = 6

export function PartyPage() {
  const mounted = usePresence(true, 0).mounted
  const state = useParty((s) => s.state)
  const busy = useParty((s) => s.busy)
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [port, setPort] = useState(() => localStorage.getItem('aurora.party.port') ?? '')
  const [publicDraft, setPublicDraft] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    useParty.getState().init()
  }, [])

  useEffect(() => {
    setPublicDraft(state.publicAddress)
  }, [state.publicAddress])

  if (!mounted) return null

  const inRoom = state.role !== 'idle'
  const roomPort = state.address.includes(':') ? state.address.slice(state.address.lastIndexOf(':') + 1) : ''

  const copyInvite = async (): Promise<void> => {
    const place = state.publicAddress || state.address
    if (!place) {
      setNote('还没有可用的地址')
      return
    }
    const text = '一起来听：' + place + ' 房间码 ' + state.code
    try {
      await navigator.clipboard.writeText(text)
      setNote('邀请已复制')
    } catch {
      setNote(text)
    }
  }

  const savePublic = async (): Promise<void> => {
    const clean = publicDraft.trim().replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/$/, '')
    await useParty.getState().setPublic(clean)
    setNote('公网地址已更新')
  }

  const startHost = (): void => {
    const value = Number(port)
    if (port && value > 1024 && value < 65536) localStorage.setItem('aurora.party.port', String(value))
    else localStorage.removeItem('aurora.party.port')
    void useParty.getState().host('房主')
  }

  return (
    <div className="party-page">
      <div className="party-page__grid">
        <section className="party-page__main">
          {inRoom ? (
            <>
              <div className="party-badge">
                <span className="party-badge__label">房间码</span>
                <span className="party-badge__code">{state.code}</span>
                <button className="rh-btn rh-btn--main" onClick={() => void copyInvite()}>
                  复制邀请
                </button>
              </div>

              <dl className="party-kv">
                <dt>局域网</dt>
                <dd>
                  {state.role === 'host' && state.addresses.length > 1
                    ? state.addresses.join(' · ')
                    : state.address || '—'}
                </dd>
                <dt>端口</dt>
                <dd>{roomPort || '—'}</dd>
                <dt>公网</dt>
                <dd>{state.publicAddress || '未设置'}</dd>
              </dl>

              {state.role === 'host' ? (
                <div className="party-page__row">
                  <input
                    className="input"
                    placeholder="填隧道给的地址，如 xxx.natfrp.cloud:23456"
                    value={publicDraft}
                    onChange={(event) => setPublicDraft(event.target.value)}
                  />
                  <button className="rh-btn" disabled={publicDraft.trim() === state.publicAddress} onClick={() => void savePublic()}>
                    保存
                  </button>
                </div>
              ) : null}

              {state.role === 'host' ? (
                <label className="party-page__check">
                  <input
                    type="checkbox"
                    checked={state.relay}
                    onChange={(event) => void useParty.getState().setRelay(event.target.checked)}
                  />
                  <span>替房间转发音频（客人不用登录也能听同一档）</span>
                </label>
              ) : null}

              <div className="party-page__row">
                <button className="rh-btn" onClick={() => void useParty.getState().leave()}>
                  离开房间
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="party-page__split">
                <div className="party-page__col">
                  <h2 className="party-page__h">开一个房间</h2>
                  <label className="party-page__field">
                    <span>房间端口</span>
                    <input
                      className="input"
                      placeholder="留空则随机"
                      value={port}
                      inputMode="numeric"
                      onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                    />
                  </label>
                  <p className="party-page__hint">
                    固定端口后，樱花隧道里那个「本地端口」只配一次。同一 WiFi 用「局域网地址 + 房间码」进，跨网络要先把端口穿到公网。
                  </p>
                  <button className="rh-btn rh-btn--main" disabled={busy} onClick={startHost}>
                    开一个房间
                  </button>
                </div>
                <div className="party-page__col">
                  <h2 className="party-page__h">加入朋友的房间</h2>
                  <label className="party-page__field">
                    <span>房主的地址</span>
                    <input
                      className="input"
                      placeholder="192.168.1.5:7890 或 xxx.natfrp.cloud:23456"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                    />
                  </label>
                  <label className="party-page__field">
                    <span>房间码</span>
                    <input
                      className="input"
                      placeholder="6 位"
                      value={code}
                      maxLength={SIX}
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                    />
                  </label>
                  <button
                    className="rh-btn rh-btn--main"
                    disabled={busy || !address.trim() || code.trim().length !== SIX}
                    onClick={() => void useParty.getState().join(address, code, '听众')}
                  >
                    加入
                  </button>
                </div>
              </div>
            </>
          )}
          {note ? <p className="party-page__hint">{note}</p> : null}
          {state.error ? <p className="party-page__hint">{state.error}</p> : null}
        </section>

        <aside className="party-page__side">
          <h2 className="party-page__h">房间里</h2>
          <dl className="party-kv">
            <dt>成员</dt>
            <dd>{state.members.map((member) => member.name).join('、') || '—'}</dd>
            <dt>正在放</dt>
            <dd>{state.now ? state.now.title + ' — ' + state.now.artist : '还没同步'}</dd>
          </dl>
          <div className="party-page__row">
            <button className="rh-btn" type="button" onClick={() => void window.aurora?.party?.openChat()}>
              聊天室
            </button>
            {state.role === 'host' ? (
              <button className="rh-btn" type="button" onClick={() => void window.aurora?.party?.openSakura()}>
                樱花隧道
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}
