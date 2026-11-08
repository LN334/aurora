import { useCallback, useEffect, useMemo, useState } from 'react'
import { bridge } from '../bridge'
import type { ShellRoute } from '../app/shell'
import { sourceLabelById, getProvider } from '../features/online/registry'
import { songsAcrossPlatforms } from '../features/online/artist-merge'
import { mergeVersions, sourcesOf } from '../features/online/unify'
import { sourceOrder } from '../features/settings/source-order'
import { useOnlineStore, type PlatformBackend } from '../features/online/store'
import type { ProviderId } from '../features/online/types'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { backToPlaylists, openOnlineAlbum, openOnlineArtist, parseRefId } from '../features/refs/navigate'
import {
  canWritePlaylist,
  deleteOnlinePlaylist,
  renameOnlinePlaylist,
  reportWrite
} from '../features/online/playlist-write'
import { ConfirmModal } from './ConfirmModal'
import { NameModal } from './NameModal'
import { formatTime } from '../ui/format'
import { Note, Play } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import { DetailHero } from './DetailHero'
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
export function OnlinePage({
  route,
  onMenu
}: {
  route: ShellRoute
  /** 曲目行的操作菜单。平台歌单页用它挂「从这张歌单移除」。 */
  onMenu?: (request: TrackMenuRequest) => void
}) {
  const ref = parseRefId(route.id)

  if (!ref) {
    return (
      <div className="col">
        <p className="pg-note">这个地址没带够信息，回上一页再点一次。</p>
      </div>
    )
  }

  if (route.view === 'onlineplaylist') {
    return <PlaylistPage providerId={ref.providerId} playlistId={ref.id} onMenu={onMenu} />
  }

  if (route.view === 'onlineartist') {
    return <ArtistPage providerId={ref.providerId} id={ref.id} />
  }

  return <AlbumPage providerId={ref.providerId} id={ref.id} />
}

/**
 * 一张平台歌单。
 *
 * 自己建的单子在这里就能改：改名、删掉、把某一行移出去。收藏来的单子是别人的
 * 东西，上游只让读，所以那些按钮不出现——页面不替用户摆一个按下去没反应的
 * 入口。
 */
function PlaylistPage({
  providerId,
  playlistId,
  onMenu
}: {
  providerId: string
  playlistId: number
  onMenu?: (request: TrackMenuRequest) => void
}) {
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
  // 推荐位上的单子不在「我的歌单」里，名字和封面靠点卡片时记下的那份脸。
  const summary = state.knownPlaylists[playlistId] ?? state.playlists.find((item) => item.id === playlistId)

  const writer = provider?.playlists ?? null
  const editable = canWritePlaylist(providerId, summary)
  const [renaming, setRenaming] = useState(false)
  const [removing, setRemoving] = useState(false)
  /*
   * 改完名字就地显示：store 里那份歌单要再过一趟网络才更新，等它会把「改名成功」
   * 画成「名字没变」。清空这一份就退回 store 的事实。
   */
  const [localName, setLocalName] = useState<string | null>(null)
  const shownName = localName ?? summary?.name ?? '歌单'

  return (
    <div className="col ol-page">
      <DetailHero
        art={
          summary?.coverUrl ? (
            <img src={remoteImageUrl(sizedImage(summary.coverUrl, 400), 400)} alt="" />
          ) : (
            <Note size={34} />
          )
        }
        kicker={(provider?.displayName ?? providerId) + ' · 歌单'}
        title={shownName}
        meta={
          <span>
            {rows.length} 首{rows.length > 0 ? ' · ' + formatTime(total) : ''}
          </span>
        }
        actions={
          <>
            <button
              className="rh-btn rh-btn--main"
              type="button"
              disabled={songs.length === 0}
              onClick={() => void store.getState().playAt(songs, 0)}
            >
              <Play size={15} />
              播放全部
            </button>
            {editable && writer?.rename ? (
              <button className="rh-btn" type="button" onClick={() => setRenaming(true)}>
                改名
              </button>
            ) : null}
            {editable && writer?.remove ? (
              <button className="rh-btn" type="button" onClick={() => setRemoving(true)}>
                删除
              </button>
            ) : null}
          </>
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
          onMenu={
            onMenu
              ? (request) =>
                  onMenu({
                    ...request,
                    onlinePlaylist: { providerId, id: playlistId, name: shownName }
                  })
              : undefined
          }
        />
      ) : state.loadingTracks ? (
        <p className="pg-note">正在读取这一张…</p>
      ) : (
        <p className="pg-note">这一张里没有能播的歌。</p>
      )}

      {renaming ? (
        <NameModal
          title="改名"
          label="歌单名"
          initial={shownName}
          confirmText="保存"
          onCancel={() => setRenaming(false)}
          onConfirm={(next) => {
            setRenaming(false)
            void renameOnlinePlaylist(providerId, playlistId, next).then((result) => {
              if (!result.ok) {
                reportWrite(result, '')
                return
              }
              setLocalName(next)
              void store.getState().loadPlaylists()
              reportWrite(result, '名字改好了')
            })
          }}
        />
      ) : null}

      {removing ? (
        <ConfirmModal
          title="删掉这张歌单？"
          body={'「' + shownName + '」会从' + (provider?.displayName ?? '平台') + '的账号里删掉，歌本身还在。'}
          confirmText="删除"
          danger
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false)
            void deleteOnlinePlaylist(providerId, playlistId).then((result) => {
              if (!result.ok) {
                reportWrite(result, '')
                return
              }
              void store.getState().loadPlaylists()
              backToPlaylists()
            })
          }}
        />
      ) : null}
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
  const [artists, setArtists] = useState<{ id: number; name: string }[]>([])
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
        setError('这个平台还没有专辑页')
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
        /*
         * 专辑艺人不只是「第一首歌的第一个人」：合作专辑有一整排人。曲目行上
         * 每一段名字都带着自己的 id，所以专辑页也能逐个点进去。
         */
        const lead = rows[0]
        const credits = lead?.artistRefs?.length
          ? lead.artistRefs.filter((person) => person.id > 0)
          : lead?.artistId
            ? [{ id: lead.artistId, name: lead.artist }]
            : []
        setArtists(credits)
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
        art={cover ? <img src={remoteImageUrl(sizedImage(cover, 400), 400)} alt="" /> : <Note size={34} />}
        kicker={(platform?.displayName ?? '在线') + ' · 专辑'}
        title={title || ' '}
        meta={
          <>
            {artists.map((person, index) => (
              <span key={person.id + ':' + index}>
                {index > 0 ? <span className="dh__sep">/</span> : null}
                <button
                  className="dh__link"
                  type="button"
                  onClick={() => openOnlineArtist(providerId as ProviderId, person.id)}
                >
                  {person.name}
                </button>
              </span>
            ))}
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
          { label: '艺人', value: artists.map((person) => person.name).join(' / ') || '—' }
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
   * 「全部歌曲」与「专辑」两个 tab 各自独立：有哪个接口就给哪个 tab。
   *
   * 从前这里写死 `providerId === 'netease'`，而取数又直接调 `bridge.netease`——
   * 于是汽水或 QQ 的艺人页要么没有这两个 tab，要么（一旦放开）把网易云同名 id
   * 的歌单当成本平台的曲目。判断依据换成这家平台自己的 catalog 能力。
   */
  const catalog = platform?.catalog
  const canAllSongs = Boolean(catalog?.artistSongs)
  const canAlbums = Boolean(catalog?.artistAlbums)
  const fullPages = canAllSongs || canAlbums

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
        setError('这个平台还没有艺人页')
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
      const source = getProvider(providerId as ProviderId)
      const cat = source?.catalog
      const engine = source?.backend as PlatformBackend | undefined
      if (!cat?.artistSongs || !engine) return
      setAllLoading(true)
      try {
        const songs = await cat.artistSongs(id, 100, offset)
        const toTrackFor = engine.toTrack as (song: never) => Track
        const rows = songs.map((song) => toTrackFor(song as never))
        setAll((previous) => (offset === 0 ? rows : [...previous, ...rows]))
      } catch {
        /* 取不到就停在已经有的那些，页面上不出现「正在加载」的僵局。 */
      } finally {
        setAllLoading(false)
      }
    },
    [id, providerId]
  )

  const loadAlbums = useCallback(async () => {
    const cat = getProvider(providerId as ProviderId)?.catalog
    if (!cat?.artistAlbums) return
    setAlbumsLoading(true)
    try {
      const rows = await cat.artistAlbums(id, 60, 0)
      setAlbums(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          coverUrl: row.picUrl,
          year: row.year,
          songCount: row.songCount
        }))
      )
    } catch {
      /* 同上：没拿到就空着，不假装有。 */
    } finally {
      setAlbumsLoading(false)
    }
  }, [id, providerId])

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
        art={cover ? <img src={remoteImageUrl(sizedImage(cover, 400), 400)} alt="" /> : <Note size={34} />}
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
          {canAllSongs ? (
            <button
              className={`ol-tab${tab === 'all' ? ' is-on' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === 'all'}
              onClick={() => setTab('all')}
            >
              全部歌曲{counts ? ` ${counts.songs}` : ''}
            </button>
          ) : null}
          {canAlbums ? (
            <button
              className={`ol-tab${tab === 'albums' ? ' is-on' : ''}`}
              type="button"
              role="tab"
              aria-selected={tab === 'albums'}
              onClick={() => setTab('albums')}
            >
              专辑{counts ? ` ${counts.albums}` : ''}
            </button>
          ) : null}
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
                onClick={() => openOnlineAlbum(providerId, album.id)}
                title={`打开《${album.name}》`}
              >
                <span className="ol-alb__art">
                  {album.coverUrl ? (
                    <img src={remoteImageUrl(sizedImage(album.coverUrl, 300), 300)} alt="" loading="lazy" />
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
