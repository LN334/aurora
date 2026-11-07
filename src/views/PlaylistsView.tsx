import { useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { useLibrary } from '../features/library/store'
import { useShelves } from '../features/online/shelves'
import { usePlaylists } from '../features/playlists/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlinePlaylist } from '../features/refs/navigate'
import { formatTime } from '../ui/format'
import { Note, Play, Plus } from '../ui/icons'
import { NameModal } from './NameModal'

/**
 * 平台歌单和自建歌单排在同一页、同一张网里。
 *
 * 平台是「歌从哪来」，不是「你去哪一页」。列表本身由 online/shelves 取，这个
 * 页面只负责把它们和自建歌单摆进同一张网。
 */
/**
 * 歌单。
 *
 * 一屏就是所有自己建的、订阅的、各平台账号里带过来的列表。本地自建的排在最前
 * （那是唯一能改的），平台的跟在后面，卡片一样大——它们对「找一张来听」是同
 * 一件事，不该在视觉上分等级。
 */
export function PlaylistsView({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const playlists = usePlaylists((state) => state.playlists)
  const create = usePlaylists((state) => state.create)
  const tracks = useLibrary((state) => state.tracks)
  const index = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const [naming, setNaming] = useState(false)

  const shelves = useShelves()

  /** 建完直接进去，而不是把人留在原地——新建的动作总该有个去处。 */
  const confirmName = (name: string) => {
    const playlist = create(name)
    setNaming(false)
    onNavigate({ view: 'playlist', id: playlist.id })
  }

  return (
    <div className="col">
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

        {shelves.map((row) => (
          <button
            className="rh-card pl-card"
            type="button"
            key={row.key}
            onClick={() => openOnlinePlaylist(row.providerId, row.id)}
          >
            <span className="rh-card__art" style={{ background: tint(row.key) }}>
              {/* 封面走主进程代理：页面 CSP 不允许外域图片，原地址由 aurora-remote:// 转发。 */}
              {row.coverUrl ? (
                <img src={remoteImageUrl(sizedImage(row.coverUrl, 300))} alt="" loading="lazy" />
              ) : (
                <Note size={20} />
              )}
              <span className={'pl-card__src src-dot--' + row.providerId}>{row.providerLabel}</span>
            </span>
            <span className="rh-card__title">{row.name}</span>
            <span className="rh-card__sub">
              {row.trackCount} 首{row.creator ? ' · ' + row.creator : ''}
            </span>
          </button>
        ))}

        <button className="rh-card pl-card" type="button" onClick={() => setNaming(true)}>
          <span className="rh-card__art rh-card__art--add">
            <Plus size={22} />
          </span>
          <span className="rh-card__title">新建歌单</span>
          <span className="rh-card__sub">从曲库里挑歌</span>
        </button>
      </div>

      {playlists.length === 0 && shelves.length === 0 ? (
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
  return 'linear-gradient(150deg, hsl(' + (h % 360) + ' 30% 26% / 0.4), hsl(' + ((h + 40) % 360) + ' 26% 13% / 0.5))'
}
