import { useEffect, useState } from 'react'
import { useParty } from '../features/party/store'
import { usePlayer } from '../features/player/store'
import { usePresence } from '../ui/presence'

/**
 * 一起听：一页。
 *
 * 借 Muonium 那套「一起听」的结构，不抄它的皮：房间头部（名字 + 两个动作）、
 * 一行元信息（房间码 · 人数 · 在听 · 播放模式 · 身份）、中间一张正在播放的卡、
 * 下面两排按钮（播放控制 / 房间动作）、最底一条细线加一行灰字。
 *
 * 这一页仍然替用户做决定：端口由程序挑，邀请是一条链接，公网连通是一颗键。
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

/** 封面：拿得到就显示，加载失败退回色块——不留破图图标。 */
function CoverFlow({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <div className="party-room__cover" />
  return <img className="party-room__cover" src={url} alt="" onError={() => setFailed(true)} />
}

export function PartyPage() {
  const mounted = usePresence(true, 0).mounted
  const state = useParty((s) => s.state)
  const busy = useParty((s) => s.busy)
  const [invite, setInvite] = useState('')
  const [publicDraft, setPublicDraft] = useState('')
  /* 房间里那首歌的封面：从播放器取，客人和房主看到的是同一首。 */
  const coverUrl = usePlayer((store) => store.queue[store.index]?.coverUrl ?? '')
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
  const host = state.role === 'host'

  const copyInvite = async (): Promise<void> => {
    if (!place) {
      setNote('房间还在起，稍等一下')
      return
    }
    const link = inviteLink(place, state.code)
    /* 主进程写剪贴板：这个协议下页面自己的 clipboard API 用不了。 */
    const copied = await window.aurora?.app?.copy(link)
    setNote(copied ? '邀请链接已复制' : link)
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

  /* 没在房间：入口就两件事——开一个，或者进别人的。 */
  if (!inRoom) {
    return (
      <div className="party-page">
        <section className="party-pick">
          {/*
            用 div 而不是 button：两张卡必须长得一样，而 <button> 在这套渲染里会拿到
            自己的合成层，backdrop-filter 的表现和旁边的 div 不一致（一深一浅）。
            语义靠 role 与键盘处理补回来。
          */}
          <div
            className={'party-pick__card' + (busy ? ' is-disabled' : '')}
            role="button"
            tabIndex={busy ? -1 : 0}
            onClick={() => {
              if (!busy) void useParty.getState().host('房主')
            }}
            onKeyDown={(event) => {
              if (!busy && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                void useParty.getState().host('房主')
              }
            }}
          >
            <span className="party-pick__icon" aria-hidden="true">＋</span>
            <strong>创建房间</strong>
            <span className="party-pick__hint">你的播放、暂停、切歌都会同步给朋友</span>
          </div>
          <div className="party-pick__card is-flat">
            <span className="party-pick__icon" aria-hidden="true">⌁</span>
            <strong>加入房间</strong>
            <span className="party-pick__hint">粘贴朋友发来的邀请链接</span>
            <div className="party-pick__join">
              <input
                className="input"
                placeholder="aurora://join?…"
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
          </div>
          {note ? <p className="party-page__hint">{note}</p> : null}
          {state.error ? <p className="party-page__hint">{state.error}</p> : null}
        </section>
      </div>
    )
  }

  /* 在房间：头部、元信息、正在播放、两排动作。 */
  return (
    <div className="party-page">
      <section className="party-room">
        <header className="party-room__head">
          {/*
            封面提到头部左侧：专辑页、艺人页都是「大图 + 右侧信息」的 hero，
            房间这里也照同一套走，不然它夹在中间像另一个应用里贴过来的。
          */}
          <CoverFlow url={coverUrl} />
          <div className="party-room__info">
            <h1 className="party-room__title">{host ? '我的一起听' : '正在加入的一起听'}</h1>
            <p className="party-room__meta">
              <b>{state.code}</b>
              <span>·</span>
              {/*
                客人刚连上那一刻还没收到房主推的成员表，这里会是 0 人——
                读起来像「房间里一个人都没有」。写「正在连」，半秒后它自己会变成数字。
              */}
              <span>{state.members.length ? state.members.length + ' 人' : host ? '1 人' : '正在连'}</span>
              <span>·</span>
              <span>{state.now ? '在放一首' : '还没有在播的歌'}</span>
              <span>·</span>
              <span>{host ? '房主' : '听众'}</span>
            </p>
          </div>
          <div className="party-room__actions">
            <button className="rh-btn" onClick={() => void copyInvite()}>
              复制邀请码
            </button>
          </div>
        </header>

        {/*
          连接信息补全：之前只有房间码，房主要把这个念给别人听时还得回樱花页看。
          局域网、公网、端口、转发开关，全摆在这里。
        */}
        <ul className="party-room__lines">
          <li>
            <i className={'party__lamp' + (state.address ? ' is-on' : '')} />
            {/*
              同一条地址，两种身份两种叫法：房主看到的是自己这条局域网地址，
              客人看到的是他连进来的那条——可能正是房主的公网隧道。
              写成「局域网」会让客人以为 frp-act.com 是内网地址。
            */}
            <b>{host ? '局域网' : '连接'}</b>
            <span>{state.address || (host ? '正在起' : '正在连')}</span>
          </li>
          {/* 公网入口与端口是房主的事：客人的连接地址里已经带着端口了。 */}
          {host ? (
            <li>
              <i className={'party__lamp' + (state.publicAddress ? ' is-on' : '')} />
              <b>公网</b>
              <span>{state.publicAddress || '仅限同一个网络'}</span>
            </li>
          ) : null}
          {host ? (
            <li>
              <i className="party__lamp" />
              <b>端口</b>
              <span>{state.address.includes(':') ? state.address.slice(state.address.lastIndexOf(':') + 1) : '—'}</span>
            </li>
          ) : null}
        </ul>

        <div className="party-room__now">
          {state.now ? (
            <>
              <div className="party-room__song">
                <strong>{state.now.title}</strong>
                <span>{state.now.artist}</span>
              </div>
            </>
          ) : (
            <div className="party-room__empty">
              <strong>房间还没有在播的歌</strong>
              <span>房主开始播放，这里就会跟着动</span>
            </div>
          )}
        </div>

        {host ? (
          <label className="party-room__relay">
            <input
              type="checkbox"
              checked={state.relay}
              onChange={(event) => void useParty.getState().setRelay(event.target.checked)}
            />
            <span>替房间转发音频（客人不用登录也能听到同一档）</span>
          </label>
        ) : null}

        <div className="party-room__tools">
          {host ? (
            <button className="rh-btn" type="button" onClick={() => { window.location.hash = '#sakura' }}>
              樱花面板
            </button>
          ) : null}
          <button className="rh-btn" onClick={() => void window.aurora?.party?.openChat()}>
            聊天室
          </button>
          <button className="rh-btn" onClick={() => void useParty.getState().leave()}>
            离开房间
          </button>
          {host && state.publicAddress ? (
            <span className="party-room__public">公网 {state.publicAddress}</span>
          ) : null}
        </div>

        {host && state.publicAddress ? (
          <div className="party-room__row">
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

        <p className="party-room__foot">
          任何成员都能看房间在放什么；房主切歌会自动同步给所有人。
        </p>
        {note ? <p className="party-page__hint">{note}</p> : null}
        {state.error ? <p className="party-page__hint">{state.error}</p> : null}
      </section>
    </div>
  )
}
