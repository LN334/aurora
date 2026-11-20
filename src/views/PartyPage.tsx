import { useEffect, useRef, useState } from 'react'
import { inviteLink, inviteText, landingLink, normalizeCode, parseInvite } from '../features/party/invite'
import { Lock } from '../ui/icons'
import { useParty } from '../features/party/store'
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

/**
 * 房间名：房主点一下就能改，客人只读。
 *
 * 名字随房间状态走，不是本机偏好——客人看到的必须是房主起的那个，否则两个人
 * 说的「房间」会指两样东西。空名字落到默认那句上，标题不会空着。
 */
function RoomTitle({
  name,
  canEdit,
  fallback,
  onRename
}: {
  name: string
  canEdit: boolean
  fallback: string
  onRename(next: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  useEffect(() => {
    if (!editing) setDraft(name)
  }, [name, editing])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next !== name) onRename(next)
  }

  if (editing) {
    return (
      <input
        className="party-room__title party-room__title--input"
        autoFocus
        value={draft}
        maxLength={24}
        placeholder="给这个房间起个名字"
        aria-label="房间名"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setDraft(name)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <h1
      className={'party-room__title' + (canEdit ? ' is-editable' : '')}
      title={canEdit ? '点一下改房间名' : undefined}
      onClick={() => {
        if (!canEdit) return
        setDraft(name)
        setEditing(true)
      }}
    >
      {name || fallback}
    </h1>
  )
}

/**
 * 房间码：房主点一下能改成自己好念的一串，客人只读。
 *
 * 随机码能念，但不好念——`K7QMX2` 在电话里得来回确认两遍。改成 `PARTY`
 * 之后同一句话就能说完。这是这间房对外的名字，所以跟着房间状态走，不存本机。
 */
function RoomCode({
  code,
  canEdit,
  onChange
}: {
  code: string
  canEdit: boolean
  onChange(next: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(code)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(code)
  }, [code, editing])

  const commit = (): void => {
    setEditing(false)
    const next = normalizeCode(draft)
    if (next.length >= 4 && next !== code) onChange(next)
  }

  if (!canEdit) return <b>{code}</b>

  if (editing) {
    return (
      <input
        className="party-room__code-input"
        ref={field}
        autoFocus
        value={draft}
        maxLength={8}
        placeholder="改成好念的"
        aria-label="房间码"
        onChange={(event) => setDraft(normalizeCode(event.target.value))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setDraft(code)
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <b
      className="party-room__code is-editable"
      title="点一下改房间码（发给别人前改，旧链接就作废了）"
      onClick={() => {
        setDraft(code)
        setEditing(true)
        requestAnimationFrame(() => field.current?.select())
      }}
    >
      {code}
    </b>
  )
}

export function PartyPage() {
  const mounted = usePresence(true, 0).mounted
  const state = useParty((s) => s.state)
  const busy = useParty((s) => s.busy)
  /* 公网那一行要一键开关 Cloudflare，所以这一页也读它的状态。 */
  const cloudflare = useParty((s) => s.cloudflare)
  const [place, setPlace] = useState('')
  const [code, setCode] = useState('')
  const [pass, setPass] = useState('')
  const [publicDraft, setPublicDraft] = useState('')
  const [passDraft, setPassDraft] = useState('')
  const [note, setNote] = useState('')
  /** 正在同一个网络里找房：这一小会儿按钮不能连点。 */
  const [finding, setFinding] = useState(false)
  /** 房主选了哪条局域网地址发出去；空串表示用默认那条。 */
  const [chosenPlace, setChosenPlace] = useState('')

  useEffect(() => {
    useParty.getState().init()
  }, [])

  useEffect(() => {
    setPublicDraft(state.publicAddress)
  }, [state.publicAddress])

  useEffect(() => {
    const saved = localStorage.getItem('aurora.party.hostAddress') ?? ''
    if (saved) setChosenPlace(saved)
  }, [])

  if (!mounted) return null

  /*
   * 「在房间里」和「正在连」是两件事。
   *
   * 连上端口不等于握手成功，中间这一截显示房间页的话，用户看到的就是一个
   * 0 人、没在播歌的空房间；连不上的时候这个空房间还会一直挂着。
   */
  const joining = state.role !== 'idle' && state.connecting
  const inRoom = state.role !== 'idle' && !state.connecting
  const host = state.role === 'host'
  const chosen = state.addresses.includes(chosenPlace) ? chosenPlace : ''
  /**
   * 发给别人那条地址。
   *
   * 房主明确挑了某条局域网地址，就用那条——他比程序更清楚朋友是坐在同一个
   * 路由器后面，还是从外面连进来。没挑过才按「公网优先」走。
   */
  const linkPlace = chosen || state.publicAddress || state.address

  const copy = async (text: string, done: string): Promise<void> => {
    const ok = await window.aurora?.app?.copy(text)
    setNote(ok ? done : '复制失败了，手抄一下：' + text)
  }

  /* 两种写法先生成好：房间还在起的时候两样都是空串，界面上就写「稍等」。 */
  /*
   * 邀请块里展示的是 https 落地页，不是 aurora:// 直链：后者在微信、浏览器里
   * 根本不会被识别成网址，发出去是一段点不动的灰字。直链仍然由解析层支持。
   */
  const inviteOf = linkPlace ? landingLink(linkPlace, state.code) : ''
  const invitePlain = linkPlace ? inviteText(linkPlace, state.code) : ''

  const copyLink = (): void => {
    if (!linkPlace) {
      setNote('房间还在起，稍等一下')
      return
    }
    void copy(inviteLink(linkPlace, state.code), '直链已复制：装了 Aurora 的电脑点开就进房')
  }

  const copyCode = (): void => {
    void copy(state.code, '房间码已复制：同一个网络里，朋友只填这串就能找到你')
  }

  const savePublic = async (): Promise<void> => {
    /* wss:// 不在这里剥：它决定走 443，剥掉就退回「裸域名 + 80 口」。 */
    const clean = publicDraft.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')
    await useParty.getState().setPublic(clean)
    /*
     * 没写进去就是被校验拦了：原因已经在 state.error 里，这里再盖一句
     * 「已更新」只会让人以为填对了。
     */
    if (useParty.getState().state.publicAddress !== clean) return
    setNote(clean ? '公网地址已更新' : '公网入口已撤掉')
  }

  const savePassword = async (value: string): Promise<void> => {
    const clean = value.trim()
    await useParty.getState().setPassword(clean)
    setPassDraft('')
    setNote(clean ? '房间已上锁：把这串密码单独告诉要进来的人' : '房间已解锁')
  }

  /*
   * 地址框既收地址也收整条邀请：粘进来的链接当场拆成地址与房间码，省得
   * 让人对着 `aurora://join?h=…&c=…` 自己找哪一截是哪一截。
   */
  const changePlace = (value: string): void => {
    const parsed = parseInvite(value)
    if (parsed && parsed.place && parsed.code) {
      setPlace(parsed.place)
      setCode(parsed.code)
      return
    }
    /* 只贴了一个房间码：把它放进该去的格子，而不是塞在地址框里装作是地址。 */
    if (parsed && !parsed.place && parsed.code) {
      setCode(parsed.code)
      setPlace('')
      return
    }
    setPlace(value)
  }

  /*
   * 加入。地址可以空着——空着就先在同一个网络里喊一声房间码。
   *
   * 这是「分享」里最省事的一段：房主不用再把五位数的端口念出来，朋友只要
   * 知道那串码。喊不到（防火墙、跨网络、房主没开）就明说，退回让房主发地址，
   * 而不是让人对着一个「正在找」转圈。
   */
  const join = async (): Promise<void> => {
    const parsed = parseInvite(place)
    const finalCode = code || parsed?.code || ''
    if (!finalCode) {
      setNote('还差房间码：房主那边能看到')
      return
    }
    let finalPlace = parsed?.place || place.trim()
    if (!finalPlace) {
      setFinding(true)
      setNote('正在同一个网络里找这间房…')
      const hit = await useParty.getState().discover(finalCode)
      setFinding(false)
      if (!hit) {
        setNote('没找到这间房：让房主把地址发你，或者确认两台在同一个网络（跨网络要走公网隧道）')
        return
      }
      if (hit.locked && !pass.trim()) {
        setNote('找到「' + (hit.name || '这间房') + '」了，它上了锁：填上房主给你的密码再点加入')
        return
      }
      finalPlace = hit.address
      setPlace(hit.address)
      setNote('找到「' + (hit.name || '这间房') + '」，正在进去')
    }
    void useParty.getState().join(finalPlace, finalCode, '听众', pass)
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
            className={'party-pick__card' + (busy || joining ? ' is-disabled' : '')}
            role="button"
            tabIndex={busy || joining ? -1 : 0}
            onClick={() => {
              if (!busy && !joining) void useParty.getState().host('房主')
            }}
            onKeyDown={(event) => {
              if (!busy && !joining && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault()
                void useParty.getState().host('房主')
              }
            }}
          >
            <span className="party-pick__icon" aria-hidden="true">＋</span>
            <strong>创建房间</strong>
            <span className="party-pick__hint">
              你的播放、暂停、切歌都会同步给朋友。开好之后可以改房间码、设密码。
            </span>
            {/* 整卡可点，但得先看得出来点它会发生什么——不然只是一块大色块。 */}
            <span className="rh-btn party-pick__cta">创建并开始 →</span>
          </div>
          <div className="party-pick__card is-flat">
            <span className="party-pick__icon" aria-hidden="true">⌁</span>
            <strong>加入房间</strong>
            <span className="party-pick__hint">
              知道房间码就能进——同一个网络里程序自己找地址。跨网络再粘房主发的邀请链接。
            </span>
            <div className="party-pick__form">
              <div className="party-pick__join">
                <input
                  className="input"
                  placeholder="邀请链接或地址（留空就凭房间码找）"
                  value={place}
                  onChange={(event) => changePlace(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void join()
                  }}
                />
                <button
                  className="rh-btn"
                  disabled={finding || joining || busy || (!place.trim() && !code.trim())}
                  onClick={() => void join()}
                >
                  {finding ? '正在找' : joining ? '正在加入' : '加入'}
                </button>
              </div>
              <div className="party-pick__join is-split">
                <input
                  className="input"
                  placeholder="房间码"
                  aria-label="房间码"
                  value={code}
                  maxLength={8}
                  onChange={(event) => setCode(normalizeCode(event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void join()
                  }}
                />
                <input
                  className="input"
                  type="password"
                  placeholder="密码（没设就留空）"
                  aria-label="房间密码"
                  value={pass}
                  onChange={(event) => setPass(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void join()
                  }}
                />
              </div>
            </div>
          </div>
          {joining ? <p className="party-page__hint">正在加入 {state.address}…</p> : null}
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
          <div className="party-room__info">
            <RoomTitle
              name={state.name}
              canEdit={host}
              fallback={host ? '我的一起听' : '正在加入的一起听'}
              onRename={(next) => void useParty.getState().rename(next)}
            />
            <p className="party-room__meta">
              <RoomCode
                code={state.code}
                canEdit={host}
                onChange={(next) => void useParty.getState().setCode(next)}
              />
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
              {state.locked ? (
                <>
                  <span>·</span>
                  <span className="party-room__lock">
                    <Lock size={12} />
                    已上锁
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <div className="party-room__actions">
            <button className="rh-btn" onClick={copyLink}>
              复制邀请链接
            </button>
            <button className="rh-btn" onClick={copyCode}>
              复制房间码
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
            {/*
              多网卡：VPN、虚拟机、第二块网卡都会往这里多塞一条地址，而第一条
              未必是朋友连得上的那条。列出来让房主挑，挑中的那条才进邀请链接。
            */}
            {host && state.addresses.length > 1 ? (
              <span className="party-room__picks">
                {state.addresses.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={'party-room__pick' + (item === chosen ? ' is-chosen' : '')}
                    title="用这条地址做邀请链接"
                    onClick={() => {
                      const next = item === chosen ? '' : item
                      setChosenPlace(next)
                      if (next) localStorage.setItem('aurora.party.hostAddress', next)
                      else localStorage.removeItem('aurora.party.hostAddress')
                    }}
                  >
                    {item}
                  </button>
                ))}
              </span>
            ) : null}
          </li>
          {/* 公网入口与端口是房主的事：客人的连接地址里已经带着端口了。 */}
          {host ? (
            <li>
              <i className={'party__lamp' + (state.publicAddress ? ' is-on' : '')} />
              <b>公网</b>
              <span>{state.publicAddress || '仅限同一个网络'}</span>
              {/*
                开公网不该要人先跑去另一个页面找隧道：房主在这一行看到「仅限同一个
                网络」，缺的就是下一颗键。Cloudflare 快速隧道不用账号与备案，点了
                就把地址写进这一栏。
              */}
              <button
                className="rh-btn"
                type="button"
                disabled={cloudflare.running && !cloudflare.address}
                onClick={() => {
                  if (cloudflare.running) void useParty.getState().stopCloudflare()
                  else void useParty.getState().startCloudflare()
                }}
              >
                {cloudflare.running && !cloudflare.address
                  ? '建立中'
                  : cloudflare.running
                    ? '关公网'
                    : '开公网'}
              </button>
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

        {/*
          邀请的两种写法，直接摆在房主眼前。

          以前只有一颗「复制」按钮：链接进了剪贴板，屏幕上却没有一处能看、能选、
          能核对——想确认发出去的是哪条地址，只能先粘到别处。链接是要发给人看的
          东西，那就该看得见。
        */}
        {host ? (
          <div className="party-room__invite">
            <div className="party-room__invite-row">
              <b>邀请链接</b>
              <code
                className="party-room__invite-text"
                title="点一下复制：装了 Aurora 的机器上，点开就能进房"
                onClick={copyLink}
              >
                {inviteOf || '房间还在起，稍等一下'}
              </code>
            </div>
            <div className="party-room__invite-row">
              <b>聊天软件里发这行</b>
              <code
                className="party-room__invite-text"
                title="点一下复制：微信、QQ 里发地址和房间码最稳"
                onClick={() => void copy(invitePlain, '邀请已复制')}
              >
                {invitePlain || '—'}
              </code>
            </div>
            <span className="party-room__invite-note">
              同一个网络里，朋友只填房间码就能找到你；跨网络（公网隧道）才需要上面那个地址。
            </span>
            {/*
              上锁之后这两行地址就不等于「能进」了：链接里没有密码，有人点开还是会被拦。
              在邀请旁边说一句，免得房主以为发出去就完事。
            */}
            {state.locked ? (
              <span className="party-room__invite-note is-locked">
                这间房上了锁：密码单独发，别和链接写在一起。
              </span>
            ) : null}
          </div>
        ) : null}

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

        {/*
          谁在房里。
          
          密码挡的是「不知道口令的人」，挡不住「口令被转发到群里」之后进来的
          那几位；已经进来的人只能请出去。所以成员名单不是装饰，它是房主能
          管住这间房的最后一只手。
        */}
        <div className="party-room__members">
          <b>成员</b>
          {state.members.length ? (
            state.members.map((member) => (
              <span
                key={member.id}
                className={'party-room__member' + (member.host ? ' is-host' : '')}
              >
                {member.name}
                {host && !member.host ? (
                  <button
                    type="button"
                    className="party-room__kick"
                    title="请出房间"
                    aria-label={'把 ' + member.name + ' 请出房间'}
                    onClick={() => void useParty.getState().kick(member.id)}
                  >
                    ×
                  </button>
                ) : null}
              </span>
            ))
          ) : (
            <span className="party-room__member">还没人</span>
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

        {/*
          锁：房间码是「房间号」，念给别人听是正常的；密码是「锁」，只发给要请
          进来的人。分开两行写，是因为这两样东西本来就该分开发。
        */}
        {host ? (
          <div className="party-room__guard">
            <b>房间密码</b>
            <span className="party-room__guard-state">
              {state.locked ? '已设置：新进来的人要填' : '没设：拿到链接的人都能进'}
            </span>
            <input
              className="input"
              type="password"
              placeholder={state.locked ? '输入新的替换' : '设一个，把房间锁上'}
              aria-label="房间密码"
              value={passDraft}
              onChange={(event) => setPassDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void savePassword(passDraft)
              }}
            />
            <button className="rh-btn" disabled={!passDraft.trim()} onClick={() => void savePassword(passDraft)}>
              设置
            </button>
            {state.locked ? (
              <button className="rh-btn" onClick={() => void savePassword('')}>
                清除
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="party-room__tools">
          {host ? (
            <button className="rh-btn" type="button" onClick={() => { window.location.hash = '#sakura' }}>
              公网隧道
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
