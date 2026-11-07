import { useMemo } from 'react'
import type { Route } from '../app/routing'
import { likedTracks, useFavorites } from '../features/favorites/store'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { usePlaylists } from '../features/playlists/store'
import { Play } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import { PlaylistList } from './PlaylistList'

/**
 * 「收藏」＝我挑过的东西：我喜欢的歌曲、我建的歌单。
 *
 * 它和音乐库的分工是两条不同的线：
 * - 音乐库按磁盘组织（歌曲 / 专辑 / 艺术家 / 文件夹），换一台机器、换一个文件夹，
 *   内容就变了；
 * - 收藏按人组织。一首歌在不在收藏里，和它存在哪个目录、来自哪个平台无关——
 *   歌单也一样，一首在线歌可以被放进歌单，而它根本没有文件。
 *
 * 歌单原来挂在音乐库的栏目里，那是把两种组织方式混在一起：音乐库的栏目由文件
 * 决定，歌单由人决定。
 */

interface CollectionViewProps {
  /** liked / playlists。 */
  tab: string
  onNavigate(route: Route): void
  onMenu(request: TrackMenuRequest): void
  /** 从 .m3u 导入歌单。复用 App 里那一份，不另建一套导入流程。 */
  onImport(): void
}

const TABS = [
  { id: 'liked', label: '我喜欢的歌曲' },
  { id: 'playlists', label: '我的歌单' }
] as const

export function CollectionView({ tab, onNavigate, onMenu, onImport }: CollectionViewProps) {
  const liked = useFavorites((state) => state.liked)
  const playlists = usePlaylists((state) => state.playlists)
  const currentTrack = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index] ?? null) : null))
  const playing = usePlayer((state) => state.playing)

  const rows = useMemo(() => likedTracks(liked), [liked])
  const likedIds = useMemo(() => new Set(liked.map((entry) => entry.id)), [liked])
  const activeTab = TABS.some((item) => item.id === tab) ? tab : 'liked'

  const body = () => {
    if (activeTab === 'playlists') {
      return (
        <PlaylistList
          playlists={playlists}
          onOpen={(id) => onNavigate({ view: 'playlists', playlistId: id })}
          onCreate={(name) => usePlaylists.getState().create(name)}
          onRemove={(id) => usePlaylists.getState().remove(id)}
          onImport={onImport}
        />
      )
    }

    if (rows.length === 0) {
      return (
        <div className="collection__empty">
          <p className="notice">还没有喜欢的歌曲。</p>
          <button className="btn" onClick={() => onNavigate({ view: 'library', tab: 'songs' })}>
            浏览音乐库
          </button>
        </div>
      )
    }

    return (
      <div className="collection__liked">
        <div className="collection__head">
          <button className="btn btn--accent" onClick={() => player.playQueue(rows, 0)}>
            <Play size={15} /> 播放全部
          </button>
          <span className="collection__count">{rows.length} 首</span>
        </div>
        <TrackList
          tracks={rows}
          currentId={currentTrack?.id ?? null}
          playing={playing}
          onPlayAt={(index) => player.playQueue(rows, index)}
          onMenu={onMenu}
          likedIds={likedIds}
        />
      </div>
    )
  }

  return (
    <div className="library">
      {/* 我喜欢的歌曲 / 我的歌单在侧栏里切，不在页内再画一排。 */}
      <div className="library__body">{body()}</div>
    </div>
  )
}
