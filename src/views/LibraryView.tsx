import { useMemo } from 'react'
import { useTrackActions } from '../app/useTrackActions'
import type { Route } from '../app/routing'
import { useRoots } from '../features/library/roots'
import { albumKey, groupAlbums, groupArtists, useLibrary } from '../features/library/store'
import { buildFolderTree } from '../features/library/tree'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import { AlbumGrid } from './AlbumGrid'
import { ArtistList } from './ArtistList'
import { EmptyLibrary } from './EmptyLibrary'
import { FolderTree } from './FolderTree'

/**
 * 「音乐库」＝磁盘上那些文件。
 *
 * 这一页曾经把在线平台也做成来源标签页（本机 / 网易云 / QQ 音乐），理由是
 * 「平台和磁盘只是想东西存在哪里」。那个理由只对了一半：
 *
 * - 本机这一侧是**曲库**，栏目由文件系统决定（歌曲、专辑、艺术家、文件夹）；
 * - 平台那一侧打开的是**账号主页**：登录状态、每日推荐、我喜欢的音乐、云盘、
 *   我的歌单。它回答的是「我这个账号里有什么」，不是「这台机器上有什么」。
 *
 * 把两者放进同一个「音乐库」标签排里，等于说磁盘和云端账号是同一种东西，
 * 而它们的入口时机完全不同：曲库随时可看；账号主页要先有账号，还常要登录。
 * 所以平台页从音乐库移走，改由账号页进入（侧栏底部的头像）。
 *
 * 平台上的歌仍然会出现在这里——通过歌单（本地建的、平台同步的都算）和播放
 * 历史，而不是通过一个叫「网易云」的曲库。
 *
 * 歌单也不在这一页（它在「收藏」）：音乐库的栏目由文件系统决定，歌单由人决定。
 */

interface LibraryViewProps {
  /** 打开的栏目：songs / albums / artists / folders。 */
  tab: string
  onNavigate(route: Route): void
  onMenu(request: TrackMenuRequest): void
  /** 添加音乐文件夹。失败提示由 App 统一处理，所以这里只需要一个 async 回调。 */
  onAddFolders(): Promise<void>
}

const TABS = [
  { id: 'songs', label: '歌曲' },
  { id: 'albums', label: '专辑' },
  { id: 'artists', label: '艺术家' },
  { id: 'folders', label: '文件夹' }
] as const

export function LibraryView({ tab, onNavigate, onMenu, onAddFolders }: LibraryViewProps) {
  const tracks = useLibrary((state) => state.tracks)
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

  const { playAlbum, playArtist, playFolder } = useTrackActions({
    tracks,
    albums,
    trackById,
    navigate: onNavigate
  })

  const activeTab = TABS.some((item) => item.id === tab) ? tab : 'songs'

  const currentAlbumId = currentTrack ? albumKey(currentTrack) : null
  const currentArtistId = currentTrack?.albumArtist ?? null
  const currentFolder = currentTrack ? currentTrack.path.replace(/[\\/][^\\/]*$/, '') : null

  const body = () => {
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

  return (
    <div className="library">
      {/* 栏目只在侧栏里切：同一件事的下一层不在一页里再画一遍。 */}

      <div className="library__body">{body()}</div>
    </div>
  )
}
