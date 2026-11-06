import { useMemo } from 'react'
import type { ComponentType } from 'react'
import { useTrackActions } from '../app/useTrackActions'
import type { Route } from '../app/routing'
import { useAvailableProviders } from '../features/online/hooks'
import { useRoots } from '../features/library/roots'
import { albumKey, groupAlbums, groupArtists, useLibrary } from '../features/library/store'
import { buildFolderTree } from '../features/library/tree'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { usePlaylistFiles } from '../features/playlists/io'
import { usePlaylists } from '../features/playlists/store'
import { NeteaseView } from '../features/netease/NeteaseView'
import { QqView } from '../features/qq/QqView'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import { AlbumGrid } from './AlbumGrid'
import { ArtistList } from './ArtistList'
import { EmptyLibrary } from './EmptyLibrary'
import { FolderTree } from './FolderTree'
import { PlaylistList } from './PlaylistList'

/**
 * 「音乐库」——我的东西，按来源切。
 *
 * 这一页把两个以前各自成区的维度放在一起：
 *
 * - **来源**（本机 / 各在线平台）是第一排标签页。本地文件不再是侧栏里的四个
 *   一级入口，它只是来源之一，和网易云平级。这正是「本地音乐分类太怪」的解法：
 *   平台和磁盘没有谁高谁低，区别只在东西存在哪里。
 * - **栏目**（歌曲 / 专辑 / 艺术家 / 歌单 / 文件夹）是第二排，只对本机来源
 *   出现。在线平台有自己的页面，因为它的栏目由平台声明（每日推荐、云盘……），
 *   本机这一侧由文件系统决定，两者不是同一组 tab。
 *
 * 详情页不在这里：点开一张专辑会走独立路由，因为只有它需要返回按钮与历史。
 */

interface LibraryViewProps {
  /** 当前来源：'local' 或平台 id。 */
  source: string
  /** 本机来源下打开的栏目。 */
  tab: string
  onNavigate(route: Route): void
  onMenu(request: TrackMenuRequest): void
  /** 添加音乐文件夹。失败提示由 App 统一处理，所以这里只需要一个 async 回调。 */
  onAddFolders(): Promise<void>
  /** 导入歌单之后的一句结果说明（成功几首、几首找不到）。 */
  onFlash(message: string): void
}

/** 平台自己的页面。新平台在这里加一行，来源标签页会自动多一项。 */
const ONLINE_VIEWS: Record<string, ComponentType> = {
  netease: NeteaseView,
  qq: QqView
}

const LOCAL_TABS = [
  { id: 'songs', label: '歌曲' },
  { id: 'albums', label: '专辑' },
  { id: 'artists', label: '艺术家' },
  { id: 'playlists', label: '歌单' },
  { id: 'folders', label: '文件夹' }
] as const

export function LibraryView({ source, tab, onNavigate, onMenu, onAddFolders, onFlash }: LibraryViewProps) {
  const providers = useAvailableProviders()
  const tracks = useLibrary((state) => state.tracks)
  const playlists = usePlaylists((state) => state.playlists)
  const { roots, busy } = useRoots()
  const scanning = useLibrary((state) => state.scanning)

  const currentTrack = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index] ?? null) : null))
  const playing = usePlayer((state) => state.playing)

  const albums = useMemo(() => groupAlbums(tracks), [tracks])
  const artists = useMemo(() => groupArtists(tracks), [tracks])
  const folderTree = useMemo(() => buildFolderTree(tracks), [tracks])
  const trackById = useMemo(() => new Map(tracks.map((item) => [item.id, item])), [tracks])

  /** 每张专辑抽一首代表曲目，用来取封面。 */
  const representative = useMemo(() => {
    const map = new Map<string, (typeof tracks)[number]>()
    for (const album of albums) {
      const first = trackById.get(album.trackIds[0])
      if (first) map.set(album.id, first)
    }
    return map
  }, [albums, trackById])

  const { playAlbum, playArtist, playFolder, createPlaylist } = useTrackActions({
    tracks,
    albums,
    trackById,
    navigate: onNavigate
  })

  const { importPlaylist } = usePlaylistFiles({
    tracks,
    activePlaylist: null,
    playlistTracks: [],
    navigate: onNavigate,
    onMessage: onFlash
  })

  const sources = useMemo(
    () => [
      { id: 'local', label: '本机' },
      ...providers.map((provider) => ({
        id: provider.id,
        label: provider.shortName ?? provider.displayName
      }))
    ],
    [providers]
  )

  // 平台没了（构建里没装）就退回本机，而不是显示一个空页面。
  const activeSource = sources.some((item) => item.id === source) ? source : 'local'
  const isLocal = activeSource === 'local'
  const activeTab = LOCAL_TABS.some((item) => item.id === tab) ? tab : 'songs'

  const currentAlbumId = currentTrack ? albumKey(currentTrack) : null
  const currentArtistId = currentTrack?.albumArtist ?? null
  const currentFolder = currentTrack ? currentTrack.path.replace(/[\\/][^\\/]*$/, '') : null

  const tabCount = (id: string): number | undefined => {
    if (id === 'songs') return tracks.length
    if (id === 'albums') return albums.length
    if (id === 'artists') return artists.length
    if (id === 'playlists') return playlists.length
    return undefined
  }

  const localBody = () => {
    if (activeTab === 'playlists') {
      return (
        <PlaylistList
          playlists={playlists}
          onOpen={(id) => onNavigate({ view: 'playlists', playlistId: id })}
          onCreate={createPlaylist}
          onRemove={(id) => usePlaylists.getState().remove(id)}
          onImport={() => void importPlaylist()}
        />
      )
    }

    // 空库只对「要文件才有内容」的栏目有意义：歌单可以导入，所以它一直在上面。
    if (tracks.length === 0) {
      return <EmptyLibrary onAdd={onAddFolders} busy={busy} scanning={scanning} roots={roots} />
    }

    if (activeTab === 'albums') {
      return (
        <AlbumGrid
          albums={albums}
          representative={representative}
          currentAlbumId={currentAlbumId}
          onOpen={(album) => onNavigate({ view: 'albums', albumId: album.id })}
          onPlay={(album) => playAlbum(album.id)}
        />
      )
    }

    if (activeTab === 'artists') {
      return (
        <ArtistList
          artists={artists}
          albums={albums}
          representative={representative}
          currentArtistId={currentArtistId}
          onOpen={(artistId) => onNavigate({ view: 'artists', artistId })}
          onPlay={playArtist}
        />
      )
    }

    if (activeTab === 'folders') {
      return (
        <FolderTree
          nodes={folderTree}
          currentFolder={currentFolder}
          onPlay={(path) => playFolder(path)}
        />
      )
    }

    return (
      <TrackList
        tracks={tracks}
        currentId={currentTrack?.id ?? null}
        playing={playing}
        onPlayAt={(index) => player.playQueue(tracks, index)}
        onMenu={onMenu}
      />
    )
  }

  const PlatformView = ONLINE_VIEWS[activeSource]

  return (
    <div className="library">
      <div className="tabs tabs--sources" role="tablist" aria-label="来源">
        {sources.map((item) => {
          const active = item.id === activeSource
          return (
            <button
              key={item.id}
              className={`tab${active ? ' is-active' : ''}`}
              role="tab"
              aria-selected={active}
              onClick={() =>
                onNavigate({ view: 'library', source: item.id, tab: activeTab })
              }
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {isLocal ? (
        <>
          <div className="tabs tabs--sub" role="tablist" aria-label="栏目">
            {LOCAL_TABS.map((item) => {
              const active = item.id === activeTab
              const count = tabCount(item.id)
              return (
                <button
                  key={item.id}
                  className={`tab${active ? ' is-active' : ''}`}
                  role="tab"
                  aria-selected={active}
                  onClick={() => onNavigate({ view: 'library', source: 'local', tab: item.id })}
                >
                  {item.label}
                  {count !== undefined ? <em>{count}</em> : null}
                </button>
              )
            })}
          </div>

          <div className="library__body">{localBody()}</div>
        </>
      ) : (
        <div className="library__body">
          {PlatformView ? (
            <PlatformView />
          ) : (
            <div className="notice">这个平台还没有自己的页面。</div>
          )}
        </div>
      )}
    </div>
  )
}
