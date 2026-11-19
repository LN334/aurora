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

  /* 没在房间：入口就两件事——开一个，或者进别人的。 */
  if (!inRoom) {
    return (
      <div className="party-page">
        <section className="party-pick">
          <button className="party-pick__card" disabled={busy} onClick={() => void useParty.getState().host('房主')}>
            <span className="party-pick__icon" aria-hidden="true">＋</span>
            <strong>创建房间</strong>
            <span className="party-pick__hint">你的播放、暂停、切歌都会同步给朋友</span>
          </button>
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
          <div>
            <h1 className="party-room__title">{host ? '我的一起听' : '正在加入的一起听'}</h1>
            <p className="party-room__meta">
              <b>{state.code}</b>
              <span>·</span>
              <span>{state.members.length} 人</span>
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
            {host && !state.publicAddress ? (
              <button className="rh-btn" onClick={() => { window.location.hash = '#sakura' }}>
                开公网
              </button>
            ) : null}
          </div>
        </header>

        <div className="party-room__now">
          {state.now ? (
            <>
              {coverUrl ? (
                <img className="party-room__cover" src={coverUrl} alt="" />
              ) : (
                <div className="party-room__cover" />
              )}
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

        <div className="party-room__tools">
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
