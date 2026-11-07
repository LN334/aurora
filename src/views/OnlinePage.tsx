import { useCallback, useEffect, useMemo, useState } from 'react'
import { bridge } from '../bridge'
import type { ShellRoute } from '../app/shell'
import { getProvider } from '../features/online/registry'
import { useOnlineStore, type PlatformBackend } from '../features/online/store'
import type { ProviderId } from '../features/online/types'
import { toTrack } from '../features/netease/track'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlineAlbum, openOnlineArtist, parseRefId } from '../features/refs/navigate'
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

  if (route.view === 'onlineartist') {
    return <ArtistPage providerId={ref.providerId} id={ref.id} onBack={back} />
  }

  return <AlbumPage providerId={ref.providerId} id={ref.id} onBack={back} />
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
 * 网易云的专辑页。
 *
 * 只有网易云有这两类取数接口。别的平台在这一层不装作有：不给入口，也就不存在
 * 点进来一堆空格子的事。
 */
function AlbumPage({ providerId, id, onBack }: { providerId: string; id: number; onBack(): void }) {
  const [title, setTitle] = useState('')
  const [meta, setMeta] = useState('读取中…')
  const [cover, setCover] = useState<string | null>(null)
  const [artist, setArtist] = useState<{ id: number; name: string } | null>(null)
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
        setError('这个平台还没有专辑的取数接口')
        setMeta('')
        return
      }
      try {
        const album = await bridge.netease.album(id)
        if (!live) return
        if (!album) {
          setError('这张专辑没有取到内容')
          return
        }
        setTitle(album.name)
        setCover(album.coverUrl)
        setArtist(album.artistId ? { id: album.artistId, name: album.artist } : null)
        const rows = album.songs.map((song: NeteaseSong) => toTrack(song))
        setTracks(rows)
        setMeta([album.year ? String(album.year) : '', `${rows.length} 首`].filter(Boolean).join(' · '))
      } catch (failure) {
        if (live) setError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [providerId, id])

  return (
    <div className="col ol-page">
      <button className="pg-back" type="button" onClick={onBack}>
        ‹ 返回
      </button>

      <header className="ol-hero">
        <div className="ol-hero__art">
          {cover ? <img src={remoteImageUrl(sizedImage(cover, 400))} alt="" /> : <Note size={32} />}
        </div>
        <div className="ol-hero__text">
          <span className="ol-hero__kicker">网易云音乐 · 专辑</span>
          <h1 className="ol-hero__title">{title || ' '}</h1>
          <p className="ol-hero__meta">
            {artist ? (
              <button
                className="trk__ref"
                type="button"
                onClick={() => openOnlineArtist('netease', artist.id)}
                title={`去 ${artist.name} 的页面`}
              >
                {artist.name}
              </button>
            ) : null}
            {artist ? ' · ' : ''}
            {meta}
          </p>
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

type ArtistTab = 'hot' | 'all' | 'albums'

/**
 * 艺人页。
 *
 * 只给「热门 50 首」等于半个艺人页：一个人真正被翻的时候，看的是「他还有哪些
 * 歌」和「他出了哪些专辑」。所以这里三块都给：热门、全部歌曲（能接着往后取）、
 * 专辑墙（点得进专辑页）。
 */
function ArtistPage({ providerId, id, onBack }: { providerId: string; id: number; onBack(): void }) {
  const [tab, setTab] = useState<ArtistTab>('hot')
  const [name, setName] = useState('')
  const [brief, setBrief] = useState('')
  const [cover, setCover] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ albums: number; songs: number } | null>(null)
  const [hot, setHot] = useState<Track[]>([])
  const [all, setAll] = useState<Track[]>([])
  const [allLoading, setAllLoading] = useState(false)
  const [albums, setAlbums] = useState<{ id: number; name: string; coverUrl: string | null; year: number | null; songCount: number }[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentTrack = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
  const playing = usePlayer((s) => s.playing)
  const platform = getProvider(providerId as ProviderId)
  /*
   * 「全部歌曲」与「专辑」两个 tab 目前只有网易云有分页与专辑墙接口；
   * 别的平台只出热门，隐藏两个点进去必然空的 tab。
   */
  const fullPages = providerId === 'netease'

  useEffect(() => {
    let live = true
    setHot([])
    setAll([])
    setAlbums([])
    setError(null)
    setTab('hot')

    const load = async () => {
      /*
       * 走统一层而不是点名网易云：热门歌曲每家平台都有，简介/头像/计数是可选的。
       * 没有简介的平台也照样出页——名字从热门歌曲里认，比整页报错有用。
       */
      const platform = getProvider(providerId as ProviderId)
      const backend = platform?.backend as PlatformBackend | undefined
      if (!platform?.catalog?.artistTopSongs || !backend) {
        setError('这个平台还没有艺人页的取数接口')
        return
      }
      try {
        const [detail, songs] = await Promise.all([
          platform.catalog.artist ? platform.catalog.artist(id).catch(() => null) : Promise.resolve(null),
          platform.catalog.artistTopSongs(id, 50)
        ])
        if (!live) return
        if (detail) {
          setName(detail.name)
          setBrief(detail.brief)
          setCover(detail.coverUrl)
          setCounts({ albums: detail.albumCount, songs: detail.songCount })
        }
        if (songs.length === 0) {
          setError('这位艺人没有取到歌曲')
          return
        }
        const toTrackFor = backend.toTrack as (song: never) => Track
        setHot(songs.map((song) => toTrackFor(song as never)))
        if (!detail) {
          const singer = songs[0]?.artists.find((entry) => entry.id === id)
          setName(singer?.name ?? songs[0]?.artists[0]?.name ?? '艺人')
          /*
           * 老接口不带头像，就把搜索里认出这个人当作头像来源——名字与 id 都对
           * 上才算，认不到宁可留空，也不拿首曲的专辑封面冒充。
           */
          if (providerId === 'netease' && singer?.name) {
            const found = await bridge.netease.search(singer.name, 'artist', 10)
            if (!live) return
            setCover(found.artists.find((entry) => entry.id === id)?.picUrl ?? null)
          }
        }
      } catch (failure) {
        if (live) setError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [providerId, id])

  const loadAll = useCallback(
    async (offset: number) => {
      setAllLoading(true)
      try {
        const songs = await bridge.netease.artistSongs(id, 100, offset)
        setAll((previous) => (offset === 0 ? songs.map((song: NeteaseSong) => toTrack(song)) : [...previous, ...songs.map((song: NeteaseSong) => toTrack(song))]))
      } catch {
        /* 取不到就停在已经有的那些，页面上不出现「正在加载」的僵局。 */
      } finally {
        setAllLoading(false)
      }
    },
    [id]
  )

  const loadAlbums = useCallback(async () => {
    setAlbumsLoading(true)
    try {
      const rows = await bridge.netease.artistAlbums(id, 60, 0)
      setAlbums(rows)
    } catch {
      /* 同上：没拿到就空着，不假装有。 */
    } finally {
      setAlbumsLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (tab === 'all' && all.length === 0 && !allLoading) void loadAll(0)
    if (tab === 'albums' && albums.length === 0 && !albumsLoading) void loadAlbums()
  }, [tab])

  const shown = tab === 'all' ? all : hot
  const currentId = currentTrack?.id ?? null

  return (
    <div className="col ol-page">
      <button className="pg-back" type="button" onClick={onBack}>
        ‹ 返回
      </button>

      <header className="ol-hero">
        <div className="ol-hero__art is-round">
          {cover ? <img src={remoteImageUrl(sizedImage(cover, 400))} alt="" /> : <Note size={32} />}
        </div>
        <div className="ol-hero__text">
          <span className="ol-hero__kicker">{platform?.displayName ?? '在线平台'} · 艺人</span>
          <h1 className="ol-hero__title">{name || ' '}</h1>
          <p className="ol-hero__meta">
            {counts
              ? [
                  counts.albums > 0 ? `${counts.albums} 张专辑` : '',
                  counts.songs > 0 ? `${counts.songs} 首歌` : ''
                ]
                  .filter(Boolean)
                  .join(' · ')
              : `热门 ${hot.length} 首`}
          </p>
          {brief ? <p className="ol-hero__brief">{brief}</p> : null}
          <div className="ol-hero__acts">
            <button
              className="rh-btn rh-btn--main"
              type="button"
              disabled={hot.length === 0}
              onClick={() => player.playQueue(hot, 0)}
            >
              <Play size={13} />
              播放热门
            </button>
          </div>
        </div>
      </header>

      {fullPages ? (
        <div className="ol-tabs" role="tablist">
          <button
            className={`ol-tab${tab === 'hot' ? ' is-on' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'hot'}
            onClick={() => setTab('hot')}
          >
            热门 50 首
          </button>
          <button
            className={`ol-tab${tab === 'all' ? ' is-on' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'all'}
            onClick={() => setTab('all')}
          >
            全部歌曲{counts ? ` ${counts.songs}` : ''}
          </button>
          <button
            className={`ol-tab${tab === 'albums' ? ' is-on' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'albums'}
            onClick={() => setTab('albums')}
          >
            专辑{counts ? ` ${counts.albums}` : ''}
          </button>
        </div>
      ) : (
        <p className="pg-note">
          热门 {hot.length} 首{counts?.songs ? ` · 这位艺人在这个平台共 ${counts.songs} 首歌` : ''}
        </p>
      )}

      {error ? <p className="pg-note">{error}</p> : null}

      {!error && tab === 'albums' ? (
        albumsLoading ? (
          <p className="pg-note">正在读专辑…</p>
        ) : albums.length > 0 ? (
          <div className="ol-grid">
            {albums.map((album) => (
              <button
                key={album.id}
                className="ol-alb"
                type="button"
                onClick={() => openOnlineAlbum('netease', album.id)}
                title={`打开《${album.name}》`}
              >
                <span className="ol-alb__art">
                  {album.coverUrl ? (
                    <img src={remoteImageUrl(sizedImage(album.coverUrl, 300))} alt="" loading="lazy" />
                  ) : (
                    <Note size={22} />
                  )}
                </span>
                <span className="ol-alb__name">{album.name}</span>
                <span className="ol-alb__meta">
                  {[album.year ? String(album.year) : '', album.songCount ? `${album.songCount} 首` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="pg-note">这位艺人没有取到专辑。</p>
        )
      ) : null}

      {!error && tab !== 'albums' ? (
        <>
          {shown.length > 0 ? (
            <TrackList
              tracks={shown}
              currentId={currentId}
              playing={playing}
              onPlayAt={(index) => player.playQueue(shown, index)}
            />
          ) : (
            <p className="pg-note">正在取歌曲…</p>
          )}
          {tab === 'all' ? (
            <div className="ol-more">
              <button
                className="rh-btn"
                type="button"
                disabled={allLoading}
                onClick={() => void loadAll(all.length)}
              >
                {allLoading ? '正在接着取…' : '再看 100 首'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
