import { useEffect, useMemo, useState } from 'react'
import { bridge } from '../bridge'
import type { ShellRoute } from '../app/shell'
import { getProvider } from '../features/online/registry'
import { useOnlineStore, type PlatformBackend } from '../features/online/store'
import { toTrack } from '../features/netease/track'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { parseRefId } from '../features/refs/navigate'
import { formatTime } from '../ui/format'
import { Note, Play } from '../ui/icons'
import { TrackList } from '../ui/TrackList'
import type { NeteaseSong } from '../env'
import type { Track } from '../types'

/**
 * 在线专辑 / 艺人 / 歌单的详情页。
 *
 * 三种东西共用一页，因为它们的版式是同一件事：一张大封面说「你打开了什么」，
 * 下面一列曲目说「里面有什么」。分成三个页面只会让这三段一模一样的头部各写
 * 一遍。
 *
 * 它们是真页面而不是弹层：从一首歌的名字点出去以后，回退键、地址栏、重新打开
 * 都该落在这一页上——弹层做不到这三件事。
 */
export function OnlinePage({ route, onNavigate }: { route: ShellRoute; onNavigate(route: ShellRoute): void }) {
  const ref = parseRefId(route.id)

  const back = () => {
    if (window.history.length > 1) window.history.back()
    else onNavigate({ view: 'playlists' })
  }

  if (!ref) {
    return (
      <div className="col">
        <p className="pg-note">这个地址没带够信息，回上一页再点一次。</p>
      </div>
    )
  }

  if (route.view === 'onlineplaylist') {
    return <PlaylistPage providerId={ref.providerId} playlistId={ref.id} onBack={back} />
  }

  return (
    <CatalogPage
      kind={route.view === 'onlineartist' ? 'artist' : 'album'}
      providerId={ref.providerId}
      id={ref.id}
      onBack={back}
    />
  )
}

/** 一张平台歌单。 */
function PlaylistPage({ providerId, playlistId, onBack }: { providerId: string; playlistId: number; onBack(): void }) {
  const store = useOnlineStore(providerId)
  const state = store()
  const provider = getProvider(providerId)

  useEffect(() => {
    void store.getState().openPlaylist(playlistId)
  }, [providerId, playlistId])

  const currentTrack = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
  const playing = usePlayer((s) => s.playing)

  const songs = state.openId === playlistId ? state.collection : []
  const rows = useMemo(
    () => (provider ? songs.map((song) => (provider.backend as PlatformBackend).toTrack(song)) : []),
    [provider, songs]
  )
  const currentId = currentTrack && provider && currentTrack.source === provider.id ? currentTrack.id : null
  const total = rows.reduce((sum, track) => sum + (track.duration ?? 0), 0)
  const summary = state.playlists.find((item) => item.id === playlistId)

  return (
    <div className="col ol-page">
      <button className="pg-back" type="button" onClick={onBack}>
        ‹ 返回
      </button>

      <header className="ol-hero">
        <div className="ol-hero__art">
          {summary?.coverUrl ? (
            <img src={remoteImageUrl(sizedImage(summary.coverUrl, 400))} alt="" />
          ) : (
            <Note size={32} />
          )}
        </div>
        <div className="ol-hero__text">
          <span className="ol-hero__kicker">{provider?.displayName ?? providerId} · 歌单</span>
          <h1 className="ol-hero__title">{summary?.name ?? '歌单'}</h1>
          <p className="ol-hero__meta">
            {rows.length} 首{rows.length > 0 ? ` · ${formatTime(total)}` : ''}
            {summary?.creator ? ` · ${summary.creator}` : ''}
          </p>
          <div className="ol-hero__acts">
            <button
              className="rh-btn rh-btn--main"
              type="button"
              disabled={songs.length === 0}
              onClick={() => void store.getState().playAt(songs, 0)}
            >
              <Play size={13} />
              播放全部
            </button>
          </div>
        </div>
      </header>

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
  )
}

/**
 * 网易云的专辑与艺人。
 *
 * 只有网易云有这两类取数接口。别的平台在这一层不装作有：不给入口，也就不存在
 * 点进来一堆空格子的事。
 */
function CatalogPage({
  kind,
  providerId,
  id,
  onBack
}: {
  kind: 'album' | 'artist'
  providerId: string
  id: number
  onBack(): void
}) {
  const [title, setTitle] = useState('')
  const [kicker, setKicker] = useState(kind === 'album' ? '专辑' : '艺人')
  const [meta, setMeta] = useState('读取中…')
  const [cover, setCover] = useState<string | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState<string | null>(null)

  const currentTrack = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
  const playing = usePlayer((s) => s.playing)

  useEffect(() => {
    let live = true
    setTracks([])
    setError(null)
    setMeta('读取中…')

    const load = async () => {
      if (providerId !== 'netease') {
        setError('这个平台还没有专辑 / 艺人的取数接口')
        setMeta('')
        return
      }
      try {
        if (kind === 'album') {
          const album = await bridge.netease.album(id)
          if (!live) return
          if (!album) {
            setError('这张专辑没有取到内容')
            return
          }
          setTitle(album.name)
          setKicker('网易云音乐 · 专辑')
          setCover(album.coverUrl)
          const rows = album.songs.map((song: NeteaseSong) => toTrack(song))
          setTracks(rows)
          setMeta(
            [album.artist, album.year ? String(album.year) : '', `${rows.length} 首`].filter(Boolean).join(' · ')
          )
          return
        }
        const songs = await bridge.netease.artistTopSongs(id, 50)
        if (!live) return
        if (songs.length === 0) {
          setError('这位艺人没有取到热门歌曲')
          return
        }
        const rows = songs.map((song: NeteaseSong) => toTrack(song))
        const singer = songs[0]?.artists.find((entry) => entry.id === id)
        setTitle(singer?.name ?? rows[0]?.albumArtist ?? '艺人')
        setKicker('网易云音乐 · 艺人')
        setTracks(rows)
        setMeta(`热门 50 首 · 共 ${rows.length} 首`)
        /*
         * 热歌接口只给歌，不给艺人自己的头像；拿专辑封面顶上去，看着就像打开错了页。
         * 所以按 id 去搜索里认这个人——名字相同、id 相同才算数，认不到再退回专辑封面。
         */
        let portrait = songs[0]?.album.picUrl ?? null
        if (singer?.name) {
          const found = await bridge.netease.search(singer.name, 'artist', 10)
          if (!live) return
          portrait = found.artists.find((entry) => entry.id === id)?.picUrl ?? portrait
        }
        setCover(portrait)
      } catch (failure) {
        if (live) setError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [kind, providerId, id])

  return (
    <div className="col ol-page">
      <button className="pg-back" type="button" onClick={onBack}>
        ‹ 返回
      </button>

      <header className="ol-hero">
        <div className={`ol-hero__art${kind === 'artist' ? ' is-round' : ''}`}>
          {cover ? <img src={remoteImageUrl(sizedImage(cover, 400))} alt="" /> : <Note size={32} />}
        </div>
        <div className="ol-hero__text">
          <span className="ol-hero__kicker">{kicker}</span>
          <h1 className="ol-hero__title">{title || ' '}</h1>
          <p className="ol-hero__meta">{meta}</p>
          <div className="ol-hero__acts">
            <button
              className="rh-btn rh-btn--main"
              type="button"
              disabled={tracks.length === 0}
              onClick={() => player.playQueue(tracks, 0)}
            >
              <Play size={13} />
              播放全部
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <p className="pg-note">{error}</p>
      ) : tracks.length > 0 ? (
        <TrackList
          tracks={tracks}
          currentId={currentTrack?.id ?? null}
          playing={playing}
          onPlayAt={(index) => player.playQueue(tracks, index)}
        />
      ) : (
        <p className="pg-note">正在取内容…</p>
      )}
    </div>
  )
}
