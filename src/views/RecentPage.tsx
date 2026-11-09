import { useEffect, useMemo, useState } from 'react'
import type { Route } from '../app/routing'
import { hydrateArtistRefs } from '../features/online/hydrate'
import { player } from '../features/player/actions'
import { useRecentEntries } from '../features/player/history-store'
import { usePlayer } from '../features/player/store'
import type { Track } from '../types'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'

/** 一次最多渲染多少条。历史可以很长，但「最近」的意义在开头。 */
const LIMIT = 200

/**
 * 最近播放：一条时间线，不是曲库里的一个栏目。
 *
 * 它和「我喜欢的」的区别是——喜欢是人的判断，最近播放是人的行为。所以它用
 * 播放时间倒序，而不是名字排序；也不给筛选，因为「最近」本身就是筛选。
 */
export function RecentPage({
  onNavigate,
  onMenu
}: {
  onNavigate(route: Route): void
  onMenu(request: TrackMenuRequest): void
}) {
  const entries = useRecentEntries()
  const currentId = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index]?.id ?? null) : null))
  const playing = usePlayer((state) => state.playing)

  const tracks = useMemo(() => {
    const out: Track[] = []
    for (const entry of entries) {
      if (!entry.track) continue
      out.push(entry.track)
      if (out.length >= LIMIT) break
    }
    return out
  }, [entries])

  /*
   * 老记录里没有 artistRefs（那时候还没这个字段），歌手名点了打不开。
   * 这里按 onlineId 回查一次，把 id 补上；补不到就照旧显示名字。
   */
  const [rows, setRows] = useState<Track[] | null>(null)
  useEffect(() => {
    let alive = true
    setRows(null)
    void hydrateArtistRefs(tracks).then((next) => {
      if (alive && next !== tracks) setRows(next)
    })
    return () => {
      alive = false
    }
  }, [tracks])
  const shown = rows && rows.length === tracks.length ? rows : tracks

  /** 今天 / 昨天 / 更早，三段。只做计数，不再造一份目录。 */
  const groups = useMemo(() => {
    const today = new Date()
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
    let now = 0
    let yest = 0
    let older = 0
    for (const entry of entries) {
      if (entry.at >= startOfToday) now += 1
      else if (entry.at >= startOfYesterday) yest += 1
      else older += 1
    }
    return { now, yest, older }
  }, [entries])

  if (tracks.length === 0) {
    return (
      <div className="pg-empty">
        <h2>还没有播放记录</h2>
        <p>听过一首歌，它就会出现在这里。推荐页上随手放一张专辑试试。</p>
        <button className="rh-btn" onClick={() => onNavigate({ view: 'discover' })}>
          去推荐页
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      <header className="rh-sec__head rv-head">
        <span className="pl-head__count">
          今天 {groups.now} · 昨天 {groups.yest} · 更早 {groups.older}
        </span>
        <button className="rh-btn" onClick={() => player.playQueue(shown, 0)}>
          从头播放
        </button>
      </header>
      <TrackList
        tracks={shown}
        currentId={currentId}
        playing={playing}
        onPlayAt={(index) => player.playQueue(shown, index)}
        onMenu={onMenu}
      />
    </div>
  )
}
