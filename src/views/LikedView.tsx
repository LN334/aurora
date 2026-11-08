import { useMemo } from 'react'
import type { ShellRoute } from '../app/shell'
import { likedTracks, useFavorites } from '../features/favorites/store'
import { usePlatformLiked } from '../features/online/platform-liked'
import { mergeVersions, sourcesOf } from '../features/online/unify'
import { sourceOrder } from '../features/settings/source-order'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { formatTime } from '../ui/format'
import { Shuffle } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'

const SOURCES: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
  kugou: '酷狗',
  qishui: '汽水'
}

/**
 * 我喜欢的音乐。
 *
 * 这里是「我点过心」的那一堆，来源打散：本机文件、网易云、QQ 可能都在里面。
 * 所以第一行先给分布（多少首来自哪），不然一屏歌名读不出它们其实不是一回事。
 * 列表本身交给 TrackList——收藏页和歌单页共用同一份行组件，收藏键才只有一处。
 */
export function LikedView({
  onNavigate,
  onMenu
}: {
  onNavigate(route: ShellRoute): void
  onMenu(request: TrackMenuRequest): void
}) {
  const liked = useFavorites((state) => state.liked)
  const currentId = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index]?.id ?? null) : null))
  const playing = usePlayer((state) => state.playing)

  /*
   * 本地心标 + 各平台账号里的「我喜欢的」，合成一张表。
   * 同一首在两家平台都有时由 mergeVersions 并成一行，两个平台徽章并排，
   * 播的时候按设置里的音源优先级挑一个——收藏页不该出现两行一样的歌名。
   */
  const { tracks: platformLiked, loading: platformLoading } = usePlatformLiked()
  const order = useMemo(() => sourceOrder(), [])
  const tracks = useMemo(
    () => mergeVersions([...likedTracks(liked), ...platformLiked], order),
    [liked, platformLiked, order]
  )
  const seconds = useMemo(() => tracks.reduce((sum, track) => sum + (track.duration || 0), 0), [tracks])
  const spread = useMemo(() => {
    const out: Record<string, number> = {}
    for (const track of tracks) {
      for (const key of sourcesOf(track, order)) out[key] = (out[key] ?? 0) + 1
    }
    return out
  }, [tracks])

  /*
   * 平台那半边还在读的时候不画空态。
   *
   * 本地心标立刻就有，平台的要走一趟网络；两者没到齐就说「还没有喜欢的歌」，
   * 等于把「正在读」说成「你没有」，页面随后再自己换一张脸。
   */
  if (platformLoading && tracks.length === 0) {
    return (
      <div className="col">
        <p className="pg-note">正在读取各平台的收藏…</p>
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <div className="pg-empty">
        <h2>还没有喜欢的歌</h2>
        <p>点心收藏</p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'home' })}>
          去推荐页
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      <header className="rh-sec__head lk-head">
        <span className="pl-head__count">
          {tracks.length} 首 · {formatTime(seconds)}
          {Object.entries(spread).map(([key, count]) => (
            <span key={key}>
              {' · '}
              {SOURCES[key] ?? '本机'} {count}
            </span>
          ))}
        </span>
        <span className="lk-head__acts">
        <button className="rh-btn" type="button" onClick={() => player.playQueue(tracks, 0)}>
          播放全部
        </button>
        <button
          className="rh-btn"
          type="button"
          onClick={() => player.playQueue(shuffled(tracks), 0)}
        >
          <Shuffle size={13} />
          随机
        </button>
        </span>
      </header>
      <TrackList
        tracks={tracks}
        currentId={currentId}
        playing={playing}
        onPlayAt={(index) => player.playQueue(tracks, index)}
        onMenu={onMenu}
      />
    </div>
  )
}

/** Fisher–Yates。不改原数组：列表还挂在 store 上，就地打乱会让页面自己跳一下。 */
function shuffled<T>(list: T[]): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]
    out[i] = out[j]
    out[j] = a
  }
  return out
}
