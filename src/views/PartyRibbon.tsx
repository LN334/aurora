import { expectedPosition, momentStale } from '../features/party/pure'
import { useParty } from '../features/party/store'
import { usePlayer } from '../features/player/store'
import { player } from '../features/player/actions'

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

  /*
   * 房主此刻听到第几秒。
   *
   * 从前这里手算 `position + (现在 - 上报时刻)`，漏了两件事：房主暂停时位置
   * 不该往前走；一条放了几十分钟之后的上报，那个差值也不再是「消息在路上」。
   * 于是播放页顶上会冒出一条「差 1812 秒」，还带着一颗按下去会 seek 到歌
   * 外面的「对齐」键——看着像房间坏了。
   */
  const mine = usePlayer((store) => store.position)
  const now = state.now
  const at = Date.now()
  const hostAt = now ? expectedPosition(now, at) : null
  const stale = now ? momentStale(now, at) : false
  const duration = now?.track?.duration ?? 0
  const drift = hostAt === null ? 0 : Math.abs(mine - hostAt)
  /* 只有推导出来的位置还落在歌里，才谈得上「对齐」；否则那颗键是死路。 */
  const alignable =
    hostAt !== null && !stale && hostAt >= 0 && (duration > 0 ? hostAt <= duration : true)

  return (
    <div className="np-party">
      <i className="party__lamp is-on" />
      <b>{state.code}</b>
      <span>{state.members.map((member) => member.name).join('、')}</span>
      {now ? <span>正在放 {now.title}</span> : <span>还没同步</span>}
      {playing.address ? <span className="np-party__public">公网 {playing.address}</span> : null}
      <button className="rh-btn" type="button" onClick={() => { window.location.hash = '#party' }}>
        回房间
      </button>
      {/*
        上报过期时说「没有更新」，而不是继续报一个算出来的差：那个数字已经
        没有意义，只是把人吓一跳。
      */}
      {stale ? (
        <span className="np-party__warn">房主那边没有更新</span>
      ) : drift > 3 ? (
        <>
          <span className="np-party__warn">差 {Math.round(drift)} 秒</span>
          {alignable ? (
            <button
              className="rh-btn"
              type="button"
              onClick={() => {
                if (hostAt !== null) player.seekTo(hostAt)
              }}
            >
              对齐
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
