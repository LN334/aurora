import { useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { useLibrary } from '../features/library/store'
import { usePlaylists } from '../features/playlists/store'
import { formatTime } from '../ui/format'
import { Note, Play, Plus } from '../ui/icons'
import { NameModal } from './NameModal'

/**
 * 歌单。
 *
 * 一屏就是所有自己建的列表。卡片比首页小一档：首页那排是「替你做选择」的
 * 推荐位，这里是你自己的抽屉，密度该高、但别挤成一堆——所以封面定宽、列间
 * 留足空气，标题与封面之间也隔开。
 */
export function PlaylistsView({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const playlists = usePlaylists((state) => state.playlists)
  const create = usePlaylists((state) => state.create)
  const tracks = useLibrary((state) => state.tracks)
  const index = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const [naming, setNaming] = useState(false)

  /** 建完直接进去，而不是把人留在原地——新建的动作总该有个去处。 */
  const confirmName = (name: string) => {
    const playlist = create(name)
    setNaming(false)
    onNavigate({ view: 'playlist', id: playlist.id })
  }

  return (
    <div className="col">
      <header className="rh-sec__head pl-head">
        <h3>我的歌单</h3>
        <span className="pl-head__count">{playlists.length} 个</span>
        <span className="pl-head__sp" />
        <button className="rh-btn" type="button" onClick={() => setNaming(true)}>
          <Plus size={14} />
          新建歌单
        </button>
      </header>

      <div className="pl-grid">
        {playlists.map((playlist) => {
          const own = playlist.trackIds.map((id) => index.get(id)).filter(Boolean)
          const seconds = own.reduce((sum, track) => sum + (track?.duration ?? 0), 0)
          const first = own[0]
          return (
            <button
              className="rh-card pl-card"
              type="button"
              key={playlist.id}
              onClick={() => onNavigate({ view: 'playlist', id: playlist.id })}
            >
              <span className="rh-card__art" style={{ background: tint(playlist.id) }}>
                {first ? (
                  <span className="rh-card__glyph">
                    <Play size={18} />
                  </span>
                ) : (
                  <Note size={20} />
                )}
              </span>
              <span className="rh-card__title">{playlist.name}</span>
              <span className="rh-card__sub">
                {playlist.trackIds.length} 首 · {formatTime(seconds)}
              </span>
            </button>
          )
        })}

        <button className="rh-card pl-card" type="button" onClick={() => setNaming(true)}>
          <span className="rh-card__art rh-card__art--add">
            <Plus size={22} />
          </span>
          <span className="rh-card__title">新建歌单</span>
          <span className="rh-card__sub">从曲库里挑歌</span>
        </button>
      </div>

      {playlists.length === 0 ? (
        <p className="pg-note">还没有歌单。新建一个，把喜欢的歌收进去。</p>
      ) : null}

      {naming ? (
        <NameModal
          title="新建歌单"
          label="名字"
          placeholder="例如 深夜循环"
          confirmText="创建"
          onCancel={() => setNaming(false)}
          onConfirm={confirmName}
        />
      ) : null}
    </div>
  )
}

function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `linear-gradient(150deg, hsl(${h % 360} 30% 26% / 0.4), hsl(${(h + 40) % 360} 26% 13% / 0.5))`
}
