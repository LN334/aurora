import { useEffect, useMemo, useState } from 'react'
import type { Route } from '../app/routing'
import { likedTracks, useFavorites } from '../features/favorites/store'
import { likeProviders, likeSourceName, useLikes } from '../features/favorites/likes'
import type { LikeSource } from '../features/favorites/like-source'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { usePlaylists } from '../features/playlists/store'
import { Play, Refresh } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import type { Track } from '../types'
import { PlaylistList } from './PlaylistList'

/**
 * 「收藏」＝我喜欢的东西：我喜欢的歌曲、我的歌单。
 *
 * 它和音乐库的分工是两条不同的线：
 * - 音乐库按磁盘组织（歌曲 / 专辑 / 艺术家 / 文件夹），换一台机器、换一个文件夹，
 *   内容就变了；
 * - 收藏按人组织。一首歌在不在收藏里，和它存在哪个目录、来自哪个平台无关——
 *   歌单也一样，一首在线歌可以被放进歌单，而它根本没有文件。
 *
 * 喜欢本身是「一个动作、两个落点」：本地文件写本机收藏，在线歌写平台账号。
 * 页面不判断这件事，只把各来源的名字摆出来让人按来源看。
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
  const slices = useLikes((state) => state.sources)
  const refreshAll = useLikes((state) => state.refreshAll)

  /*
   * 来源筛选：'all' 或某个来源 id。默认全部——收藏页的答案是「我喜欢的歌」，
   * 而不是先让人挑平台；按来源看是追一个问题时才切过去。
   */
  const [filter, setFilter] = useState<'all' | LikeSource>('all')

  const providers = useMemo(() => likeProviders(), [])

  // 进页面拉一次在线来源。store 里对已就绪的来源会跳过，不必在这里判重。
  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const localRows = useMemo(() => likedTracks(liked), [liked])

  /** 按来源切好的行，本机在前、平台按注册顺序。 */
  const bySource = useMemo(() => {
    const list: { source: LikeSource; name: string; rows: Track[] }[] = [
      { source: 'local', name: likeSourceName('local'), rows: localRows }
    ]
    for (const provider of providers) {
      const slice = slices[provider.id]
      if (slice?.state === 'ready') list.push({ source: provider.id, name: likeSourceName(provider.id), rows: slice.tracks })
    }
    return list
  }, [localRows, providers, slices])

  const rows = useMemo(() => {
    if (filter === 'all') return bySource.flatMap((part) => part.rows)
    return bySource.find((part) => part.source === filter)?.rows ?? []
  }, [bySource, filter])

  /*
   * 未登录的来源单独说一句。不查登录状态的话，平台返回的空列表和「你确实没
   * 喜欢过」长得一样，页面就会把没登录说成没内容。
   */
  const anonymous = providers.filter((provider) => slices[provider.id]?.state === 'anonymous')
  const failed = providers.filter((provider) => slices[provider.id]?.state === 'error')

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

    const countOf = (source: 'all' | LikeSource): number =>
      source === 'all' ? bySource.reduce((total, part) => total + part.rows.length, 0) : (bySource.find((part) => part.source === source)?.rows.length ?? 0)

    if (countOf('all') === 0 && anonymous.length === providers.length && providers.length > 0) {
      return (
        <div className="collection__empty">
          <p className="notice">还没有本机喜欢的歌；登录平台后，你在平台上喜欢的歌也会出现在这里。</p>
          <div className="collection__empty-acts">
            <button className="btn btn--accent" onClick={() => onNavigate({ view: 'accounts' })}>
              去登录
            </button>
            <button className="btn" onClick={() => onNavigate({ view: 'library', tab: 'songs' })}>
              浏览音乐库
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="collection__liked">
        <div className="collection__head">
          <button className="btn btn--accent" onClick={() => player.playQueue(rows, 0)} disabled={rows.length === 0}>
            <Play size={15} /> 播放全部
          </button>
          <span className="collection__count">{rows.length} 首</span>

          <div className="collection__filters" role="tablist" aria-label="按来源筛选">
            <button
              className={`chip${filter === 'all' ? ' is-active' : ''}`}
              role="tab"
              aria-selected={filter === 'all'}
              onClick={() => setFilter('all')}
            >
              全部
            </button>
            {bySource.map((part) => (
              <button
                key={part.source}
                className={`chip${filter === part.source ? ' is-active' : ''}`}
                role="tab"
                aria-selected={filter === part.source}
                onClick={() => setFilter(part.source)}
              >
                {part.name} <span className="collection__chip-count">{part.rows.length}</span>
              </button>
            ))}
          </div>

          <button
            className="icon-btn collection__refresh"
            title="重新拉取在线喜欢"
            aria-label="重新拉取在线喜欢"
            onClick={() => void refreshAll(true)}
          >
            <Refresh size={15} />
          </button>
        </div>

        {anonymous.length > 0 ? (
          <div className="collection__hint">
            <span>
              登录{anonymous.map((provider) => provider.shortName ?? provider.displayName).join('、')}
              后，你在那边喜欢的歌也会出现在这里。
            </span>
            <button className="btn btn--small" onClick={() => onNavigate({ view: 'accounts' })}>
              去登录
            </button>
          </div>
        ) : null}

        {failed.length > 0 ? (
          <div className="collection__hint">
            <span>{failed[0].shortName ?? failed[0].displayName}的喜欢列表没拉到，稍后再试。</span>
            <button className="btn btn--small" onClick={() => void refreshAll(true)}>
              重试
            </button>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="collection__empty">
            <p className="notice">
              {filter === 'all'
                ? '还没有喜欢的歌。'
                : `${likeSourceName(filter)}里还没有喜欢的歌。`}
            </p>
            <button className="btn" onClick={() => (filter === 'all' ? onNavigate({ view: 'library', tab: 'songs' }) : setFilter('all'))}>
              {filter === 'all' ? '浏览音乐库' : '看全部'}
            </button>
          </div>
        ) : (
          <TrackList
            tracks={rows}
            currentId={currentTrack?.id ?? null}
            playing={playing}
            onPlayAt={(index) => player.playQueue(rows, index)}
            onMenu={onMenu}
          />
        )}
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
