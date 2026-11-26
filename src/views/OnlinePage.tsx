import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { supportsCapability } from '../features/online/capability'
import { sourceLabelById, getProvider } from '../features/online/registry'
import { songsAcrossPlatforms } from '../features/online/artist-merge'
import { albumAcrossPlatforms, type AlbumOnPlatform } from '../features/online/album-unify'
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
import { formatSpan } from '../ui/format'
import { Note, Play } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import { ShelfSearch } from '../ui/ShelfSearch'
import { FILTER_EVENT } from '../ui/filter-event'
import { filterPlaylistRows } from '../features/library/playlist-filter'
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
  /*
   * 五百多首的歌单也只能滚着找。筛出来的是「看哪首」，`filterPlaylistRows` 带着
   * 每行在 `songs` 里的原始下标，点一行播的还是那首。
   */
  const [query, setQuery] = useState('')
  const filtering = query.trim() !== ''
  const visible = useMemo(() => filterPlaylistRows(rows, query), [rows, query])
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
        en="PLAYLIST"
        kicker="歌单"
        title={shownName}
        actions={
          <>
            <button
              className="dbtn dbtn--main"
              type="button"
              disabled={songs.length === 0}
              onClick={() => void store.getState().playAt(songs, 0)}
            >
              <Play size={15} />
              播放全部
            </button>
            {editable && writer?.rename ? (
              <button className="dbtn" type="button" onClick={() => setRenaming(true)}>
                改名
              </button>
            ) : null}
            {editable && writer?.remove ? (
              <button className="dbtn" type="button" onClick={() => setRemoving(true)}>
                删除
              </button>
            ) : null}
          </>
        }
        stats={[
          { value: rows.length, label: '曲目' },
          { value: rows.length > 0 ? formatSpan(total) : '—', label: '时长' },
          { value: summary?.creator || '—', label: '创建者' },
          { value: provider?.displayName ?? providerId, label: '平台' }
        ]}
      />

      {rows.length > 0 ? (
        <div className="lk-search">
          <ShelfSearch
          value={query}
          placeholder="在这个歌单里找"
          onChange={setQuery}
          listenEvent={FILTER_EVENT}
          hideTrigger
        />
          <span className="lk-search__count">
            {filtering ? `${visible.length} / ${rows.length} 首` : `${rows.length} 首`}
          </span>
        </div>
      ) : null}

      {rows.length > 0 && visible.length === 0 ? (
        <p className="shelf-empty">没有匹配的歌。</p>
      ) : rows.length > 0 ? (
        <TrackList
          tracks={visible.map((row) => row.track)}
          currentId={currentId}
          playing={playing}
          onPlayAt={(index) => void store.getState().playAt(songs, visible[index].index)}
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
      ) : state.fail ? (
        /*
         * 「平台这次没给」和「这张里真的没有」是两件事。把它写成后者，用户会以为
         * 歌单空了 —— 五百多首的歌单因为一次 502 显示成 0 首，比报错更让人慌。
         */
        <div className="pg-empty">
          <h2>没读到这张歌单</h2>
          <p>
            {state.fail.message ? state.fail.message + '。' : ''}
            多半是网络或平台接口的一时问题，过一会儿再试。
          </p>
          <button className="rh-btn" type="button" onClick={() => void store.getState().openPlaylist(playlistId)}>
            重试
          </button>
        </div>
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
 * 专辑页。
 *
 * 主平台先画，别家后到：同一张唱片在几家平台上各有一份时，这里的曲目会被合并成
 * 一行一首、行尾挂各自的来源徽章，页头的「来源」把几家一起列出来。合并只认曲目
 * 指纹（标题 + 主艺人 + 时长档），名字相同但曲目对不上的是另一张碟，不并。
 */
function AlbumPage({ providerId, id }: { providerId: string; id: number }) {
  const [title, setTitle] = useState('')
  const [cover, setCover] = useState<string | null>(null)
  const [artists, setArtists] = useState<{ id: number; name: string }[]>([])
  const [year, setYear] = useState<number | null>(null)
  const [brief, setBrief] = useState('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [others, setOthers] = useState<AlbumOnPlatform[]>([])
  const [error, setError] = useState<string | null>(null)

  const currentTrack = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
  const playing = usePlayer((s) => s.playing)

  useEffect(() => {
    let live = true
    setTracks([])
    setOthers([])
    setError(null)

    const load = async () => {
      /*
       * 走统一层：每家的专辑都回同一形状（抬头 + 曲目），页面不必知道是哪一家。
       * 没有专辑接口的平台在这里拿到 null，页面会说「没取到内容」而不是假装空。
       */
      const source = getProvider(providerId as ProviderId)
      const backend = source?.backend as PlatformBackend | undefined
      if (!backend || !source?.catalog?.album || !supportsCapability(source, 'albums')) {
        setError('这个平台还没有专辑页')
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
        /*
         * 别家的同一张唱片是后找的：首屏不等它。找到了才把列表换掉——换的时候
         * 主平台的顺序不变，别家独有的曲目接在后面。
         */
        const primary: AlbumOnPlatform = {
          providerId,
          label: sourceLabelById(providerId),
          name: album.name,
          artistName: lead?.albumArtist || lead?.artist || '',
          tracks: rows
        }
        void albumAcrossPlatforms(primary, sourceOrder()).then((across) => {
          if (!live || across.others.length === 0) return
          setOthers(across.others)
          setTracks(across.tracks)
        })
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
        en="ALBUM"
        kicker="专辑"
        title={title || ' '}
        meta={
          <>
            {artists.map((person, index) => (
              <span key={person.id + ':' + index}>
                {index > 0 ? <span className="sep2">/</span> : null}
                <button
                  className="dp__link"
                  type="button"
                  onClick={(event) =>
                    openOnlineArtist(providerId as ProviderId, person.id, event.currentTarget)
                  }
                >
                  {person.name}
                </button>
              </span>
            ))}
          </>
        }
        actions={
          <button
            className="dbtn dbtn--main"
            type="button"
            disabled={tracks.length === 0}
            onClick={() => player.playQueue(tracks, 0)}
          >
            <Play size={15} />
            播放全部
          </button>
        }
        stats={[
          { value: tracks.length, label: '曲目' },
          { value: year ? String(year) : '—', label: '发行' },
          {
            value: [sourceLabelById(providerId), ...others.map((other) => other.label)].join(' · '),
            label: '来源'
          }
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
  /* 首屏那份热门列表，"全部歌曲"的第一页要拿它兜底，保证全部 ⊇ 热门。 */
  const hotRef = useRef<Track[]>([])
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
      if (!backend || !platform?.catalog?.artistTopSongs || !supportsCapability(platform, 'artists')) {
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
        const order = sourceOrder()
        const hotRows = mergeVersions([...seed, ...across], order)
        hotRef.current = hotRows.length > 0 ? hotRows : seed
        setHot(hotRef.current)
        /*
         * "全部歌曲"跟着热门一起备好第一页。
         *
         * 两个 tab 说的是同一个人，口径必须一样宽：热门是"本平台热门 + 别家搜索"，
         * 全部若只取本平台分页，就会出现"热门 50 首、全部 3 首"这种自相矛盾的页。
         * 这里先把热门并进来去重，全部就必然 ⊇ 热门；页头曲目数也因此只有一个来源。
         * 往后翻页仍只追加本平台（别家没有分页接口）。
         */
        let allRows = hotRef.current
        const listMore = platform?.catalog?.artistSongs
        if (listMore) {
          const rest = await listMore.call(platform.catalog, id, 100, 0).catch(() => [])
          if (!live) return
          allRows = mergeVersions([...hotRef.current, ...rest.map((song) => toTrackFor(song as never))], order)
          setAll(allRows)
        }
        if (detail) {
          /*
           * 上游报的总数有时只覆盖本平台那部分。数字比列表还少，读起来就成了
           * "热门比全部多"——所以取上游数与合并后列表长度的大者。
           */
          setCounts({ albums: detail.albumCount, songs: Math.max(detail.songCount, allRows.length) })
        }
        if (!detail) {
          const singer = songs[0]?.artists.find((entry) => entry.id === id)
          setName(singer?.name ?? songs[0]?.artists[0]?.name ?? '艺人')
          /*
           * 这家平台的艺人详情不带头像时，把搜索里认出这个人当作头像来源——名字
           * 与 id 都对上才算，认不到宁可留空，也不拿首曲的专辑封面冒充。走平台
           * 的 search 通道，不再点名网易云：哪家没有 search 就不补这一手。
           */
          if (platform?.search && singer?.name) {
            const found = await platform.search.search(singer.name, 'artist', 10).catch(() => null)
            if (!live) return
            setCover(found?.artists.find((entry) => entry.id === id)?.picUrl ?? null)
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
        let rows = songs.map((song) => toTrackFor(song as never))
        /*
         * 第一页兜底：首屏那次已经并过热门与别家，这里只补没赶上的人。
         * 两个 tab 同一个人、同一口径；翻页之后只追加本平台。
         */
        if (offset === 0) {
          const across = name ? await songsAcrossPlatforms(name, sourceOrder(), providerId) : []
          rows = mergeVersions([...hotRef.current, ...rows, ...across], sourceOrder())
        }
        setAll((previous) => (offset === 0 ? rows : [...previous, ...rows]))
      } catch {
        /* 取不到就停在已经有的那些，页面上不出现「正在加载」的僵局。 */
      } finally {
        setAllLoading(false)
      }
    },
    [id, providerId, name]
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
  }, [id, providerId, name])

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
        en="ARTIST"
        kicker="艺人"
        title={name || ' '}
        actions={
          <button
            className="dbtn dbtn--main"
            type="button"
            disabled={hot.length === 0}
            onClick={() => player.playQueue(hot, 0)}
          >
            <Play size={15} />
            播放热门
          </button>
        }
        stats={[
          { value: counts ? counts.songs : hot.length, label: '曲目' },
          { value: counts && counts.albums > 0 ? counts.albums : '—', label: '专辑' },
          { value: sourceText, label: '来源', highlight: usedSources.length > 1 }
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
                onClick={(event) => openOnlineAlbum(providerId, album.id, event.currentTarget)}
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
