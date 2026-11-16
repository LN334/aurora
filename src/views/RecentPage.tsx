import { useEffect, useMemo, useState } from 'react'
import type { Route } from '../app/routing'
import { hydrateArtistRefs } from '../features/online/hydrate'
import { player } from '../features/player/actions'
import { groupPlaysByDay, type PlayEntry } from '../features/player/history'
import { useHistoryState, usePlayEntries, useRecentEntries } from '../features/player/history-store'
import { hourLabel, summarizeListening } from '../features/player/stats'
import { shelfMatches } from '../features/library/playlist-filter'
import { usePlayer } from '../features/player/store'
import type { Track } from '../types'
import { formatSpan } from '../ui/format'
import { ShelfSearch } from '../ui/ShelfSearch'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'

const DAY_MS = 24 * 60 * 60 * 1000

/** 一周含今天，所以往前推六天。 */
const WEEK_DAYS = 7

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

type Scope = 'week' | 'all'

/**
 * 最近播放：一条时间线，不是曲库里的一个栏目。
 *
 * 它和「我喜欢的」的区别是——喜欢是人的判断，最近播放是人的行为。所以它用
 * 播放时间倒序，而不是名字排序。明细（plays）保留了半年的每一次开始，于是
 * 这里可以按天分段：「今天」「昨天」「8 月 3 日 · 周一」。段与段之间是同一
 * 张列表，前缀续排，点某一首就接着往下播。
 *
 * 老档案里没有 plays，只有按歌去重的 recent。那种情况下退回一条扁列表，
 * 不假装有分段——凭空编日期比少一段更糟。
 */
export function RecentPage({
  onNavigate,
  onMenu
}: {
  onNavigate(route: Route): void
  onMenu(request: TrackMenuRequest): void
}) {
  const plays = usePlayEntries()
  const recent = useRecentEntries()
  const currentId = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index]?.id ?? null) : null))
  const playing = usePlayer((state) => state.playing)
  const [scope, setScope] = useState<Scope>('week')
  const [query, setQuery] = useState('')

  const history = useHistoryState()

  /*
   * 统计固定看一周，不跟下面的列表切「全部」。
   * 时长的数据源（days）只留 30 天，而次数（plays）留 180 天；把两者放进
   * 同一个「全部」里，两个数字说的就不是同一段时间了。
   */
  const stats = useMemo(() => summarizeListening(history, Date.now(), 'week'), [history])

  /*
   * 页面开着跨零点不必立刻重排，所以「今天」只取一次。
   * 这比每次渲染都 new Date() 稳定，也省得 useMemo 每秒失效。
   */
  const startOfToday = useMemo(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  }, [])

  const groups = useMemo(() => {
    /*
     * 搜索只筛「这一条记录」，不筛日期分组：筛完某天可能一条不剩，
     * 那一天就自然不出现，而不是留个空标题。
     *
     * `plays` 与 `recent` 是同一个 `RecentEntry` 形状；真正决定那一行能不能
     * 显示的是 `track` 快照（没有快照的记录下方列表本来就会跳过），所以这里
     * 也只在有快照的记录上匹配。
     */
    const q = query.trim()
    const keep = (entry: PlayEntry) => {
      if (!q) return true
      const track = entry.track
      if (!track) return false
      return shelfMatches(q, track.title, track.artist)
    }
    if (plays.length) {
      const cutoff = scope === 'week' ? startOfToday - (WEEK_DAYS - 1) * DAY_MS : 0
      return groupPlaysByDay(plays.filter((entry) => entry.at >= cutoff && keep(entry)))
    }
    return recent.length ? [{ day: '', entries: recent.filter(keep) }] : []
  }, [plays, recent, scope, startOfToday, query])

  const flat = useMemo(
    () =>
      groups.flatMap((group) =>
        group.entries.flatMap((entry) => (entry.track ? [entry.track] : []))
      ),
    [groups]
  )

  /*
   * 老记录里没有 artistRefs（那时候还没这个字段），歌手名点了打不开。
   * 这里按 onlineId 回查一次，把 id 补上；补不到就照旧显示名字。
   * 分段之后仍然只查一次：每组用的都是这一份快照。
   */
  const [rows, setRows] = useState<Track[] | null>(null)
  useEffect(() => {
    let alive = true
    setRows(null)
    void hydrateArtistRefs(flat).then((next) => {
      if (alive && next !== flat) setRows(next)
    })
    return () => {
      alive = false
    }
  }, [flat])
  const shown = rows && rows.length === flat.length ? rows : flat
  const byId = useMemo(() => new Map(shown.map((track) => [track.id, track])), [shown])
  /*
   * 一周内的次数与全部次数一样时只说一遍：两串相同的数字并排，读起来像没算对。
   */
  const weekCount = plays.filter((entry) => entry.at >= startOfToday - (WEEK_DAYS - 1) * DAY_MS).length

  /*
   * 每一段的行，以及这一段第一行在整条时间线里的位置。
   * 点行号播的是整条时间线（不是这一天），所以「下一首」会顺着走到前一天。
   */
  const days = useMemo(() => {
    let offset = 0
    const out: { day: string; tracks: Track[]; offset: number }[] = []
    for (const group of groups) {
      const tracks: Track[] = []
      for (const entry of group.entries) {
        if (!entry.track) continue
        tracks.push(byId.get(entry.track.id) ?? entry.track)
      }
      if (!tracks.length) continue
      out.push({ day: group.day, tracks, offset })
      offset += tracks.length
    }
    return out
  }, [groups, byId])

  if (days.length === 0) {
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
          {plays.length
            ? weekCount === plays.length
              ? `最近一周 ${weekCount} 次`
              : `最近一周 ${weekCount} 次 · 全部 ${plays.length} 次`
            : `${recent.length} 首`}
        </span>
        <span className="rv-head__acts">
          {/* 范围切换放在计数右边：先看数，再决定要不要放宽。 */}
          <span className="rv-scope" role="group" aria-label="时间范围">
            <button
              className={'rv-scope__opt' + (scope === 'week' ? ' is-on' : '')}
              onClick={() => setScope('week')}
              aria-pressed={scope === 'week'}
            >
              最近一周
            </button>
            <button
              className={'rv-scope__opt' + (scope === 'all' ? ' is-on' : '')}
              onClick={() => setScope('all')}
              aria-pressed={scope === 'all'}
            >
              全部
            </button>
          </span>
          <button className="rh-btn" onClick={() => player.playQueue(shown, 0)}>
            从头播放
          </button>
        </span>
      </header>

      {stats.days > 0 ? (
        <section className="rv-stats" aria-label="这周的收听">
          <div className="rv-stats__nums">
            <div className="rv-stats__num">
              <b>{formatSpan(stats.seconds)}</b>
              <span>这周听了</span>
            </div>
            <div className="rv-stats__num">
              <b>{stats.tracks} 首</b>
              <span>不重复</span>
            </div>
          </div>
          {/*
            连续天数是跨周的指标，放进上面那排会被读成「这周 9 天」。
            所以它和另外两句一起，作为对数字的补充说明。
          */}
          <p className="rv-stats__note">
            {[`连着听 ${stats.streak} 天`, stats.topArtists.length ? `最常听 ${stats.topArtists[0].name}` : '', stats.topHour !== null ? `多在${hourLabel(stats.topHour)}` : '']
              .filter(Boolean)
              .join(' · ')}
          </p>
        </section>
      ) : null}

      {plays.length || recent.length ? (
        <div className="lk-search">
          <ShelfSearch value={query} placeholder="搜标题、歌手" onChange={setQuery} />
          {query.trim() ? (
            <span className="lk-search__count">
              {groups.reduce((sum, group) => sum + group.entries.length, 0)} 条
            </span>
          ) : null}
        </div>
      ) : null}

      {days.length === 0 && query.trim() ? <p className="shelf-empty">没有匹配的播放记录。</p> : null}

      {days.map((day) => (
        <section className="rv-day" key={day.day || 'recent'}>
          {day.day ? (
            <h3 className="rv-day__head">
              {dayLabel(day.day, startOfToday)}
              <span className="rv-day__count">{day.tracks.length} 首</span>
            </h3>
          ) : null}
          <TrackList
            tracks={day.tracks}
            currentId={currentId}
            playing={playing}
            onPlayAt={(index) => player.playQueue(shown, day.offset + index)}
            onMenu={onMenu}
          />
        </section>
      ))}
    </div>
  )
}

/**
 * 「今天」「昨天」，再往前给日期与星期。
 *
 * 星期比日期好认：人记得「上周三晚上」，不记得「11 月 5 日」。跨年时才补年份。
 */
function dayLabel(day: string, startOfToday: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const instant = new Date(year, month - 1, date).getTime()
  if (instant === startOfToday) return '今天'
  if (instant === startOfToday - DAY_MS) return '昨天'
  const base = `${month} 月 ${date} 日 · ${WEEKDAYS[new Date(instant).getDay()]}`
  return year === new Date(startOfToday).getFullYear() ? base : `${year} 年 ${base}`
}
