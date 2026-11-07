import { useCallback, useEffect, useMemo, useState } from 'react'
import { bridge } from '../bridge'
import type { ShellRoute } from '../app/shell'
import { sourceLabelById, getProvider } from '../features/online/registry'
import { songsAcrossPlatforms } from '../features/online/artist-merge'
import { mergeVersions, sourcesOf } from '../features/online/unify'
import { sourceOrder } from '../features/settings/source-order'
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
import { DetailHero } from './DetailHero'
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
export function OnlinePage({ route }: { route: ShellRoute }) {
  const ref = parseRefId(route.id)

  if (!ref) {
    return (
      <div className="col">
        <p className="pg-note">这个地址没带够信息，回上一页再点一次。</p>
      </div>
    )
  }

  if (route.view === 'onlineplaylist') {
    return <PlaylistPage providerId={ref.providerId} playlistId={ref.id} />
  }

  if (route.view === 'onlineartist') {
    return <ArtistPage providerId={ref.providerId} id={ref.id} />
  }

  return <AlbumPage providerId={ref.providerId} id={ref.id} />
}

/** 一张平台歌单。 */
function PlaylistPage({ providerId, playlistId }: { providerId: string; playlistId: number }) {
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
      <DetailHero
        art={
          summary?.coverUrl ? (
            <img src={remoteImageUrl(sizedImage(summary.coverUrl, 400))} alt="" />
          ) : (
            <Note size={34} />
          )
        }
        kicker={(provider?.displayName ?? providerId) + ' · 歌单'}
        title={summary?.name ?? '歌单'}
        meta={
          <span>
            {rows.length} 首{rows.length > 0 ? ' · ' + formatTime(total) : ''}
          </span>
        }
        actions={
          <button
            className="rh-btn rh-btn--main"
            type="button"
            disabled={songs.length === 0}
            onClick={() => void store.getState().playAt(songs, 0)}
          >
            <Play size={15} />
            播放全部
          </button>
        }
        facts={[
          { label: '平台', value: provider?.displayName ?? providerId },
          { label: '曲目', value: rows.length + ' 首' },
          { label: '时长', value: rows.length > 0 ? formatTime(total) : '—' },
          { label: '创建者', value: summary?.creator || '—' }
        ]}
      />

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
function AlbumPage({ providerId, id }: { providerId: string; id: number }) {
  const [title, setTitle] = useState('')
  const [meta, setMeta] = useState('读取中…')
  const [cover, setCover] = useState<string | null>(null)
  const [artist, setArtist] = useState<{ id: number; name: string } | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [brief, setBrief] = useState('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [error, setError] = useState<string | null>(null)

  const currentTrack = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
  const playing = usePlayer((s) => s.playing)
  const platform = getProvider(providerId as ProviderId)

  useEffect(() => {
    let live = true
    setTracks([])
    setError(null)
    setMeta('读取中…')

    const load = async () => {
      /*
       * 走统一层：每家的专辑都回同一形状（抬头 + 曲目），页面不必知道是哪一家。
       * 没有专辑接口的平台在这里拿到 null，页面会说「没取到内容」而不是假装空。
       */
      const source = getProvider(providerId as ProviderId)
      const backend = source?.backend as PlatformBackend | undefined
      if (!source?.catalog?.album || !backend) {
        setError('暂不支持该平台')
        setMeta('')
        return
      }
      try {
        const album = await source.catalog.album(id)
        if (!live) return
        if (!album) {
          setError('这张专辑没有取到内容')
          return
        }
        const toTrackFor = backend.toTrack as (song: never) => Track
        const rows = album.songs.map((song) => toTrackFor(song as never))
        setTitle(album.name)
        setCover(album.coverUrl)
        setTracks(rows)
        const first = rows[0]
        setArtist(first?.artistId ? { id: first.artistId, name: first.artist } : null)
        setYear(album.year ?? null)
        setBrief(album.description ?? '')
        setMeta([String(rows.length) + ' 首'].filter(Boolean).join(' · '))
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
      <DetailHero
        art={cover ? <img src={remoteImageUrl(sizedImage(cover, 400))} alt="" /> : <Note size={34} />}
        kicker={(platform?.displayName ?? '在线') + ' · 专辑'}
        title={title || ' '}
        meta={
          <>
            {artist ? (
              <button
                className="dh__link"
                type="button"
                onClick={() => openOnlineArtist(providerId as ProviderId, artist.id)}
              >
                {artist.name}
              </button>
            ) : null}
            <span>{meta}</span>
          </>
        }
        actions={
          <button
            className="rh-btn rh-btn--main"
            type="button"
            disabled={tracks.length === 0}
            onClick={() => player.playQueue(tracks, 0)}
          >
            <Play size={15} />
            播放全部
          </button>
        }
        facts={[
          { label: '平台', value: platform?.displayName ?? '在线' },
          { label: '发行', value: year ? String(year) : '—' },
          { label: '曲目', value: String(tracks.length) + ' 首' },
          { label: '艺人', value: artist?.name ?? '—' }
        ]}
        brief={brief}
      />

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
function ArtistPage({ providerId, id }: { providerId: string; id: number }) {
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
        setError('暂不支持该平台')
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
        const resolvedName =
          detail?.name ??
          songs[0]?.artists.find((entry) => entry.id === id)?.name ??
          songs[0]?.artists[0]?.name ??
          ''
        const toTrackFor = backend.toTrack as (song: never) => Track
        const seed = songs.map((song) => toTrackFor(song as never))
        /*
         * 同一个人在各平台都有页；这里按名字把别家的歌也并进来，
         * 页面因此是这个艺人的全部可听曲目，不是某一家平台的切片。
         */
        const across = await songsAcrossPlatforms(resolvedName, sourceOrder(), providerId)
        if (!live) return
        const merged = mergeVersions([...seed, ...across], sourceOrder())
        setHot(merged.length > 0 ? merged : seed)
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
  /* 这一页的歌实际来自哪些平台——合并之后不再等于打开它的那个平台。 */
  const usedSources = useMemo(() => {
    const order = sourceOrder()
    const set = new Set<string>()
    for (const track of shown) for (const id of sourcesOf(track, order)) set.add(id)
    return [...set]
  }, [shown])
  const sourceText = usedSources.length > 0 ? usedSources.map(sourceLabelById).join(' + ') : platform?.displayName ?? '在线'

  return (
    <div className="col ol-page">
      <DetailHero
        round
        art={cover ? <img src={remoteImageUrl(sizedImage(cover, 400))} alt="" /> : <Note size={34} />}
        kicker={(platform?.displayName ?? '在线平台') + ' · 艺人'}
        title={name || ' '}
        meta={
          <span>
            {counts
              ? [
                  counts.albums > 0 ? counts.albums + ' 张专辑' : '',
                  counts.songs > 0 ? counts.songs + ' 首歌' : ''
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '热门 ' + hot.length + ' 首'}
            {usedSources.length > 1 ? ` · 跨 ${usedSources.length} 个平台` : ''}
          </span>
        }
        actions={
          <button
            className="rh-btn rh-btn--main"
            type="button"
            disabled={hot.length === 0}
            onClick={() => player.playQueue(hot, 0)}
          >
            <Play size={15} />
            播放热门
          </button>
        }
        facts={[
          { label: '平台', value: sourceText },
          { label: '单曲', value: counts ? String(counts.songs) : String(hot.length) },
          { label: '专辑', value: counts && counts.albums > 0 ? String(counts.albums) : '—' },
          { label: '热门', value: hot.length + ' 首' }
        ]}
        brief={brief}
      />

      {fullPages ? (
        <div className="ol-tabs" role="tablist">
          <button
            className={`ol-tab${tab === 'hot' ? ' is-on' : ''}`}
            type="button"
            role="tab"
            aria-selected={tab === 'hot'}
            onClick={() => setTab('hot')}
          >
            热门 {hot.length} 首
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
