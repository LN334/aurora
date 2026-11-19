import { useParty } from '../features/party/store'

/**
 * 播放页顶上的一条「一起听」。
 *
 * 只有在房间里时才出现：房间码、人数、房主在放什么、差多少。它是「我现在听到的
 * 不是我自己一个人在看」的唯一提示——播放页本身没有别的地方能看出这件事。
 */
export function PartyRibbon() {
  const state = useParty((store) => store.state)
  const playing = useParty((store) => store.tunnel)

  if (state.role === 'idle') return null

  const behind = state.now ? Math.round((Date.now() - state.now.at) / 1000) : 0
  const drift = state.now && state.now.position ? Math.abs(behind - 0) : 0

  return (
    <div className="np-party">
      <i className="party-lamp is-on" />
      <b>{state.code}</b>
      <span>{state.members.map((member) => member.name).join('、')}</span>
      {state.now ? <span>正在放 {state.now.title}</span> : <span>还没同步</span>}
      {playing.address ? <span className="np-party__public">公网 {playing.address}</span> : null}
      <button className="rh-btn" type="button" onClick={() => { window.location.hash = '#party' }}>
        回房间
      </button>
      {drift > 3 ? <span className="np-party__warn">差 {drift} 秒</span> : null}
    </div>
  )
}
