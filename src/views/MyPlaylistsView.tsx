import { useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { useLibrary } from '../features/library/store'
import { mineOnly, useAccountPlaylists } from '../features/online/playlist-cards'
import { usePlaylists } from '../features/playlists/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlinePlaylist } from '../features/refs/navigate'
import { formatTime } from '../ui/format'
import { Note, Play, Plus } from '../ui/icons'
import { NameModal } from './NameModal'

/**
 * 我的歌单：自己建的那些。
 *
 * 这一页以前不存在——自建歌单和平台收藏的歌单挤在「收藏歌单」同一张网里，新建
 * 入口也是那张网里的第 N 格。结果是「收藏」这页既装别人的东西，又装自己的，
 * 名字还写着「收藏」。现在按「谁建的」分家：
 *
 * - 这一页只放自己建的（本机 + 平台自建），新建入口在这里，因为这是唯一一处
 *   能建歌单的地方。
 * - 平台收藏来的在隔壁「收藏的歌单」，那页只读。
 *
 * 平台自建的那一段平时是空的：四家里只有网易云在接口上分得清自建与收藏，另外
 * 三家只给一张混表，宁可标「分不出来」也不猜（见 `playlist-cards.ts`）。
 */
export function MyPlaylistsView({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const playlists = usePlaylists((state) => state.playlists)
  const create = usePlaylists((state) => state.create)
  const tracks = useLibrary((state) => state.tracks)
  const index = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const [naming, setNaming] = useState(false)

  const cards = useAccountPlaylists()
  const platformMine = useMemo(() => mineOnly(cards), [cards])

  /** 建完直接进去，而不是把人留在原地——新建的动作总该有个去处。 */
  const confirmName = (name: string) => {
    const playlist = create(name)
    setNaming(false)
    onNavigate({ view: 'playlist', id: playlist.id })
  }

  return (
    <div className="col">
      <section className="rh-sec">
        <header className="rh-sec__head">
          <h3>
            <Note size={14} /> 我建的
          </h3>
          <span className="rh-more">{playlists.length} 个</span>
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
          <p className="pg-note">还没有自己的歌单。新建一个，把从各处挑来的歌收进去。</p>
        ) : null}
      </section>

      {platformMine.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>平台上的</h3>
            <span className="rh-more">
              在平台上自己建的歌单，{platformMine.length} 个
            </span>
          </header>
          <div className="pl-grid">
            {platformMine.map((row) => (
              <button
                className="rh-card pl-card"
                type="button"
                key={row.key}
                onClick={() => openOnlinePlaylist(row.providerId, row)}
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
                  {row.trackCount > 0 ? row.trackCount + ' 首' : row.providerLabel}
                </span>
              </button>
            ))}
          </div>
        </section>
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
