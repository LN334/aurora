import { useEffect } from 'react'
import { useOnlineStore } from '../features/online/store'
import type { ProviderId } from '../features/online/types'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlinePlaylist } from '../features/refs/navigate'
import { Note } from '../ui/icons'

/**
 * 一个平台的歌单架子。
 *
 * 歌单页不该按平台分页——平台是「歌从哪来」，不是「你去哪一页」。所以这里只交出
 * 一段：这个账号有几张歌单，一张一张排开，和本地歌单用的是同一套卡片。没登录、
 * 或者账号里一张都没有时整段不出现，空的平台分区只是噪音。
 *
 * 点开一张走的是真页面（`#onlineplaylist/<provider>/<id>`），不是弹层：看完这张
 * 想回到歌单列表，回退键应当把他送回原处，而不是关掉一层浮层。
 */
export function OnlineShelf({ providerId, heading }: { providerId: ProviderId; heading: string }) {
  const store = useOnlineStore(providerId)
  const state = store()

  useEffect(() => {
    void store.getState().init()
  }, [providerId])

  if (state.playlists.length === 0) return null

  return (
    <section className="rh-sec shelf">
      <header className="rh-sec__head">
        <h3>{heading}</h3>
        <span className="pl-head__count">{state.playlists.length} 个</span>
      </header>

      <div className="pl-grid">
        {state.playlists.map((playlist) => (
          <button
            className="rh-card pl-card"
            type="button"
            key={playlist.id}
            onClick={() => openOnlinePlaylist(providerId, playlist.id)}
          >
            <span className="rh-card__art" style={{ background: tint(String(playlist.id)) }}>
              {/* 封面走主进程代理：页面 CSP 不允许外域图片，原地址由 aurora-remote:// 转发。 */}
              {playlist.coverUrl ? (
                <img src={remoteImageUrl(sizedImage(playlist.coverUrl, 300))} alt="" loading="lazy" />
              ) : (
                <Note size={20} />
              )}
            </span>
            <span className="rh-card__title">{playlist.name}</span>
            <span className="rh-card__sub">
              {playlist.trackCount} 首{playlist.creator ? ` · ${playlist.creator}` : ''}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `linear-gradient(150deg, hsl(${h % 360} 30% 26% / 0.4), hsl(${(h + 40) % 360} 26% 13% / 0.5))`
}
