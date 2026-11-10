import { useMemo } from 'react'
import type { ShellRoute } from '../app/shell'
import { dailyBatch, usePlatformDaily } from '../features/online/daily'
import { SLOTS } from '../features/online/slots'
import { dailyLabel } from '../features/library/daily'
import { useTasteProfile } from '../features/library/taste-hooks'
import { useLibrary } from '../features/library/store'
import { player } from '../features/player/actions'
import { useRecentEntries } from '../features/player/history-store'
import { usePlayer } from '../features/player/store'
import { Shuffle } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import type { Track } from '../types'

/**
 * 每日推荐：一页跟「我喜欢的音乐」同级的列表。
 *
 * 它不该只是首页上的一块卡片——「今天听什么」是一件事，用户会想翻完、想
 * 从头播、想把某一首拖进歌单。卡片负责「现在就听」，这一页负责「今天这一批
 * 是哪些」。
 */
export function DailyPage({
  onNavigate,
  onMenu
}: {
  onNavigate(route: ShellRoute): void
  onMenu(request: TrackMenuRequest): void
}) {
  const tracks = useLibrary((state) => state.tracks)
  const recent = useRecentEntries()
  const currentId = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index]?.id ?? null) : null))
  const playing = usePlayer((state) => state.playing)

  const recentAll = useMemo(() => {
    const out: Track[] = []
    for (const entry of recent) if (entry.track) out.push(entry.track)
    return out
  }, [recent])

  const { tracks: platformDaily } = usePlatformDaily()
  // 口味画像只影响排序；没有历史时退化成按日期挑。
  const taste = useTasteProfile()

  const daily = useMemo(() => {
    // 本机一首都没有时退到最近播放：对在线用户来说那也是「我的歌」。
    const base = tracks.length > 0 ? tracks : recentAll
    // 和首页那块同一个函数、同一个槽位：卡片写多少首，这一页就是多少首。
    return dailyBatch(platformDaily, base, new Date(), SLOTS.daily, taste)
  }, [tracks, recentAll, platformDaily, taste])

  if (daily.length === 0) {
    return (
      <div className="pg-empty">
        <h2>今天还没有可推荐的</h2>
        <p>等你往里放几张专辑，这里每天会换一批。</p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'home' })}>
          去推荐页
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      <header className="rh-sec__head dl-head">
        <span className="pl-head__count">
          每日推荐 · {dailyLabel()} · {daily.length} 首
        </span>
        <span className="lk-head__acts">
          <button className="rh-btn" type="button" onClick={() => player.playQueue(daily, 0)}>
            播放全部
          </button>
          <button
            className="rh-btn"
            type="button"
            onClick={() => player.playQueue(shuffle(daily), 0)}
          >
            <Shuffle size={13} />
            随机
          </button>
        </span>
      </header>

      <TrackList
        tracks={daily}
        currentId={currentId}
        playing={playing}
        onPlayAt={(index) => player.playQueue(daily, index)}
        onMenu={onMenu}
      />
    </div>
  )
}

/** Fisher–Yates。不改原数组：daily 是从 store 算出来的，就地打乱会让页面跳一下。 */
function shuffle<T>(list: T[]): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]
    out[i] = out[j]
    out[j] = a
  }
  return out
}
