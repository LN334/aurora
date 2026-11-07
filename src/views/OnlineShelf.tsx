import { useEffect, useState } from 'react'
import { getProvider } from '../features/online/registry'
import { useOnlineStore, type PlatformBackend } from '../features/online/store'
import type { ProviderId } from '../features/online/types'
import { usePlayer } from '../features/player/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { formatTime } from '../ui/format'
import { Close, Note, Play } from '../ui/icons'
import { TrackList } from '../ui/TrackList'

/**
 * 一个平台的歌单架子。
 *
 * 歌单页不该按平台分页——平台是「歌从哪来」，不是「你去哪一页」。所以这里只交出
 * 一段：这个账号有几张歌单，一张一张排开，和本地歌单用的是同一套卡片。没登录、
 * 或者账号里一张都没有时整段不出现，空的平台分区只是噪音。
 */
export function OnlineShelf({ providerId, heading }: { providerId: ProviderId; heading: string }) {
  const store = useOnlineStore(providerId)
  const state = store()
  const [open, setOpen] = useState<{ id: number; name: string } | null>(null)

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
            onClick={() => setOpen({ id: playlist.id, name: playlist.name })}
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

      {open ? (
        <Sheet
          providerId={providerId}
          platform={heading.replace(/ · 歌单$/, '')}
          playlistId={open.id}
          name={open.name}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  )
}

/**
 * 歌单曲目。
 *
 * 用弹窗而不是新开一页：平台歌单和个人歌单是同一种东西，页面就那么一张；把
 * 「看这一张里面有什么」压在同一个页面里，看完关掉还在原地。
 */
function Sheet({
  providerId,
  platform,
  playlistId,
  name,
  onClose
}: {
  providerId: ProviderId
  platform: string
  playlistId: number
  name: string
  onClose(): void
}) {
  const store = useOnlineStore(providerId)
  const state = store()
  const provider = getProvider(providerId)

  useEffect(() => {
    void store.getState().openPlaylist(playlistId)
  }, [providerId, playlistId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const currentTrack = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
  const playing = usePlayer((s) => s.playing)

  const songs = state.openId === playlistId ? state.collection : []
  const rows = provider ? songs.map((song) => (provider.backend as PlatformBackend).toTrack(song)) : []
  const currentId = currentTrack && provider && currentTrack.source === provider.id ? currentTrack.id : null
  const total = rows.reduce((sum, track) => sum + (track.duration ?? 0), 0)

  return (
    <div className="sheet__scrim" onPointerDown={onClose}>
      <div className="sheet" role="dialog" aria-label={name} onPointerDown={(event) => event.stopPropagation()}>
        <header className="sheet__head">
          <div className="sheet__ident">
            <p className="sheet__kicker">{platform} · 歌单</p>
            <h2 className="sheet__title">{name}</h2>
            <p className="sheet__meta">
              {rows.length} 首{rows.length > 0 ? ` · ${formatTime(total)}` : ''}
            </p>
          </div>
          <div className="sheet__acts">
            <button
              className="rh-btn rh-btn--main"
              type="button"
              disabled={rows.length === 0}
              onClick={() => void store.getState().playAt(songs, 0)}
            >
              <Play size={13} />
              播放全部
            </button>
            <button className="icon-btn" type="button" onClick={onClose} title="关闭" aria-label="关闭">
              <Close size={16} />
            </button>
          </div>
        </header>

        <div className="sheet__body">
          {rows.length > 0 ? (
            <TrackList
              tracks={rows}
              currentId={currentId}
              playing={playing}
              onPlayAt={(index) => void store.getState().playAt(songs, index)}
            />
          ) : state.loadingTracks ? (
            <p className="pg-note">正在读取这一张…</p>
          ) : (
            <p className="pg-note">这一张里没有能播的歌。</p>
          )}
        </div>
      </div>
    </div>
  )
}

function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `linear-gradient(150deg, hsl(${h % 360} 30% 26% / 0.4), hsl(${(h + 40) % 360} 26% 13% / 0.5))`
}
