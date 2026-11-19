import { useEffect, useState } from 'react'
import { useParty } from '../features/party/store'
import { usePresence } from '../ui/presence'

/**
 * 一起听：一页。
 *
 * 这一页替用户做决定，不让他填东西：端口由程序挑，邀请是一条链接，公网连通是
 * 一颗键。页面上只有「房间怎么了」和「你现在能做什么」。
 */

/** 邀请链接：一条就够，别人点开就是进房。 */
function inviteLink(place: string, code: string): string {
  return 'aurora://join?h=' + encodeURIComponent(place) + '&c=' + encodeURIComponent(code)
}

/** 从粘贴进来的东西里认出「地址 + 房间码」：完整链接或「地址 房间码」都认。 */
function parseInvite(raw: string): { place: string; code: string } | null {
  const text = raw.trim()
  if (!text) return null
  const byUrl = /[?&]h=([^&]+).*?[?&]c=([A-Za-z0-9]+)/.exec(text)
  if (byUrl) return { place: decodeURIComponent(byUrl[1]), code: byUrl[2].toUpperCase() }
  const parts = text.split(/\s+/)
  if (parts.length === 2 && parts[1].length === 6) return { place: parts[0], code: parts[1].toUpperCase() }
  return null
}

export function PartyPage() {
  const mounted = usePresence(true, 0).mounted
  const state = useParty((s) => s.state)
  const busy = useParty((s) => s.busy)
  const [invite, setInvite] = useState('')
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
  const place = state.publicAddress || state.address
  const roomPort = state.address.includes(':') ? state.address.slice(state.address.lastIndexOf(':') + 1) : ''

  const copyInvite = async (): Promise<void> => {
    if (!place) {
      setNote('房间还在起，稍等一下')
      return
    }
    const link = inviteLink(place, state.code)
    try {
      await navigator.clipboard.writeText(link)
      setNote('邀请链接已复制')
    } catch {
      setNote(link)
    }
  }

  const savePublic = async (): Promise<void> => {
    const clean = publicDraft.trim().replace(/^wss?:\/\//, '').replace(/^https?:\/\//, '').replace(/\/$/, '')
    await useParty.getState().setPublic(clean)
    setNote('公网地址已更新')
  }

  const join = (): void => {
    const parsed = parseInvite(invite)
    if (!parsed) {
      setNote('没认出邀请链接：贴 aurora://join?h=…&c=… 或「地址 房间码」都行')
      return
    }
    void useParty.getState().join(parsed.place, parsed.code, '听众')
  }

  return (
    <div className="party-page">
      <div className="party-page__grid">
      <section className="party-stage">
        {inRoom ? (
          <>
            <div className="party-stage__code">
              <span className="party-stage__label">房间码</span>
              <b>{state.code}</b>
              <button className="rh-btn rh-btn--main" onClick={() => void copyInvite()}>
                复制邀请
              </button>
            </div>

            <ul className="party-lines">
              <li>
                <i className={'party-lamp' + (state.address ? ' is-on' : '')} />
                局域网 <span>{state.address || '正在起'}</span>
              </li>
              <li>
                <i className={'party-lamp' + (state.publicAddress ? ' is-on' : '')} />
                公网 <span>{state.publicAddress || '没开'}</span>
                {state.role === 'host' && !state.publicAddress ? (
                  <button className="rh-btn" onClick={() => { window.location.hash = '#sakura' }}>
                    开公网
                  </button>
                ) : null}
              </li>
              <li>
                <i className="party-lamp is-on" />
                {state.members.map((member) => member.name).join('、') || '—'}
                <span>{state.now ? state.now.title + ' — ' + state.now.artist : '还没同步'}</span>
              </li>
            </ul>

            {state.role === 'host' && state.publicAddress ? (
              <div className="party-stage__row">
                <input
                  className="input"
                  placeholder="公网地址不对？填隧道给的"
                  value={publicDraft}
                  onChange={(event) => setPublicDraft(event.target.value)}
                />
                <button className="rh-btn" disabled={publicDraft.trim() === state.publicAddress} onClick={() => void savePublic()}>
                  改
                </button>
              </div>
            ) : null}

            <div className="party-stage__foot">
              <button className="rh-btn" type="button" onClick={() => void window.aurora?.party?.openChat()}>
                聊天室
              </button>
              <button className="rh-btn" onClick={() => void useParty.getState().leave()}>
                离开房间
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className="party-stage__title">开一个房间</h1>
            <p className="party-stage__hint">端口、地址都由程序管，你只管把邀请发出去。</p>
            <button className="rh-btn rh-btn--main party-stage__big" disabled={busy} onClick={() => void useParty.getState().host('房主')}>
              开一个房间
            </button>

            <div className="party-stage__split">
              <span>有邀请链接？</span>
              <input
                className="input"
                placeholder="贴进来就行"
                value={invite}
                onChange={(event) => setInvite(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') join()
                }}
              />
              <button className="rh-btn" disabled={!invite.trim()} onClick={join}>
                加入
              </button>
            </div>
          </>
        )}
        {note ? <p className="party-stage__hint">{note}</p> : null}
        {state.error ? <p className="party-stage__hint">{state.error}</p> : null}
        {roomPort ? <p className="party-stage__tiny">房间端口 {roomPort}</p> : null}
      </section>

      <aside className="party-page__side">
        <h2 className="party-page__h">怎么用</h2>
        <ol className="party-steps">
          <li>点「开一个房间」，房间码出现在上面。</li>
          <li>点「复制邀请」，得到一条链接。</li>
          <li>把链接发给朋友，他点开就进来了。</li>
        </ol>
        <h2 className="party-page__h">跨网络</h2>
        <p className="party-page__hint">
          同一个 WiFi 能直连。不在一个网里，要先把房间端口穿到公网——用樱花隧道，房间里会多一颗「开公网」。
        </p>
        <h2 className="party-page__h">音质</h2>
        <p className="party-page__hint">
          房主取什么，全房间听什么。客人没登录平台也能听到，因为音频走房间转发。
        </p>
      </aside>
      </div>
    </div>
  )
}
