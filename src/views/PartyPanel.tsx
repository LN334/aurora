import { useEffect, useState } from 'react'
import type { PartyNow } from '../env'
import { useParty } from '../features/party/store'
import { usePlayer } from '../features/player/store'
import { Close, User } from '../ui/icons'
import { usePresence } from '../ui/presence'

/**
 * 一起听面板。
 *
 * 房间开在本机进程里：房主这边显示「地址 + 6 位码」，同一 WiFi 下的人在自己
 * 面板里填这两样进来。同步的是「听什么、听到哪」，不是音频本体——每台机器
 * 各自取流，所以房间里的人都得能听到同一首歌（同一平台、同一账号权限）。
 */

function currentNow(): PartyNow | null {
  const playback = usePlayer.getState()
  const track = playback.queue[playback.index] ?? null
  if (!track) return null
  return {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    at: Date.now(),
    position: playback.position,
    playing: playback.playing
  }
}

export function PartyPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const { mounted, closing } = usePresence(open, 320)
  const state = useParty((s) => s.state)
  const busy = useParty((s) => s.busy)
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (open) useParty.getState().init()
  }, [open])

  if (!mounted) return null

  const inRoom = state.role !== 'idle'
  const push = async () => {
    const now = currentNow()
    if (!now) {
      setNote('当前没有在放的歌')
      return
    }
    await useParty.getState().push(now)
    setNote('已把你现在这首同步给房间')
  }

  return (
    <aside className={`panel${closing ? ' is-closing' : ''}`} aria-label="一起听">
      <header className="panel__head">
        <h2 className="panel__title">一起听</h2>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭一起听">
          <Close size={16} />
        </button>
      </header>

      {!inRoom ? (
        <div className="panel__body">
          <p className="pg-note">
            房间开在这台电脑上，同一 WiFi 下的人用「地址 + 房间码」进来。同步的是听什么、听到哪，音频各自取。
          </p>
          <button className="rh-btn" disabled={busy} onClick={() => void useParty.getState().host('房主')}>
            <User size={15} />
            开一个房间
          </button>
          <div className="party__join">
            <input
              className="input"
              placeholder="房主的地址，如 192.168.1.5:7890"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            <input
              className="input"
              placeholder="房间码"
              value={code}
              maxLength={6}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <button
              className="rh-btn"
              disabled={busy || !address.trim() || code.trim().length !== 6}
              onClick={() => void useParty.getState().join(address, code, '听众')}
            >
              加入
            </button>
          </div>
          {state.error ? <p className="pg-note">{state.error}</p> : null}
        </div>
      ) : (
        <div className="panel__body">
          <dl className="party__facts">
            <dt>房间码</dt>
            <dd>{state.code || '—'}</dd>
            <dt>地址</dt>
            <dd>{state.address || '—'}</dd>
            <dt>成员</dt>
            <dd>{state.members.map((member) => member.name).join('、') || '—'}</dd>
            <dt>现在</dt>
            <dd>{state.now ? state.now.title + ' — ' + state.now.artist : '还没同步'}</dd>
          </dl>
          {state.role === 'host' ? (
            <button className="rh-btn" onClick={() => void push()}>
              同步我现在这首
            </button>
          ) : null}
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
