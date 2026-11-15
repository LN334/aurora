import type { HistoryState } from './history'

/**
 * 收听统计：把播放明细与每日累计折成一组数字。
 *
 * 和 `history.ts` 一样保持纯函数——数据从 store 来，时钟从调用方来，
 * 这样「上周听了多久」可以在测试里钉死，不必等一整天。
 *
 * 两个数据源分工要说清：秒数只有 `days` 有（按天累计，保留 30 天），
 * 次数与曲目只有 `plays` 有（半年明细，最多 2000 条）。所以「全部」
 * 的时长最多只到 30 天，而次数可以到 180 天——这不是 bug，是两份数据
 * 的保留期不同，界面上该按各自的口径说。
 */

type StatsRange = 'week' | 'month' | 'all'

const DAY_MS = 24 * 60 * 60 * 1000

/** 榜单取前几名。三个以上就挤，五个刚好一屏不换行。 */
const STATS_TOP = 5

interface StatsArtist {
  name: string
  seconds: number
}

interface StatsTrack {
  id: string
  title: string
  artist: string
  count: number
}

interface ListeningStats {
  /** 窗口内累计听了多久，来自 `days`。 */
  seconds: number
  /** 窗口内起播次数，来自 `plays`。 */
  plays: number
  /** 窗口内听过的不重复曲目数。 */
  tracks: number
  /** 窗口内有记录的天数。 */
  days: number
  topArtists: StatsArtist[]
  topTracks: StatsTrack[]
  /** 24 个桶，下标即小时。 */
  hours: number[]
  /** 最常听的那一个小时，没有记录时 null。 */
  topHour: number | null
  /** 从今天往前数，连续有收听记录的天数。 */
  streak: number
}

/** 范围对应多少天；`all` 不设窗口。 */
function rangeDays(range: StatsRange): number {
  if (range === 'week') return 7
  if (range === 'month') return 30
  return Number.POSITIVE_INFINITY
}

/** 本地零点，统计窗口按天切而不是按小时切。 */
function startOfDay(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * 本地日历日的 `YYYY-MM-DD`。
 *
 * 这里自己算而不是从 `history.ts` 借 `dayKey`：那边是值导出，测试用 Node
 * 直跑 TS 时无法解析不带扩展名的相对路径（项目源文件统一省略扩展名）。
 * 四行代码换掉一条只能靠打包器才成立的依赖，划算。
 */
function localDay(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function emptyStats(): ListeningStats {
  return {
    seconds: 0,
    plays: 0,
    tracks: 0,
    days: 0,
    topArtists: [],
    topTracks: [],
    hours: Array.from({ length: 24 }, () => 0),
    topHour: null,
    streak: 0
  }
}

/**
 * 折出窗口内的统计。
 *
 * 并列时按名字/曲目 id 兜底排序，免得每次渲染顺序都变——一个会自己跳动的
 * 榜单比没有榜单更让人怀疑算错了。
 */
export function summarizeListening(history: HistoryState, at: number, range: StatsRange): ListeningStats {
  const span = rangeDays(range)
  const since = Number.isFinite(span) ? startOfDay(at) - (span - 1) * DAY_MS : Number.NEGATIVE_INFINITY
  const sinceDay = Number.isFinite(span) ? localDay(since) : null

  const days = sinceDay ? history.days.filter((item) => item.day >= sinceDay) : history.days
  const plays = history.plays.filter((entry) => entry.at >= since)

  const stats = emptyStats()
  if (!days.length && !plays.length) return stats

  stats.seconds = days.reduce((sum, day) => sum + day.seconds, 0)
  stats.days = days.length
  stats.plays = plays.length

  const artistSeconds = new Map<string, number>()
  for (const day of days) {
    for (const [name, seconds] of Object.entries(day.artists)) {
      if (!(seconds > 0)) continue
      artistSeconds.set(name, (artistSeconds.get(name) ?? 0) + seconds)
    }
  }
  stats.topArtists = [...artistSeconds.entries()]
    .map(([name, seconds]) => ({ name, seconds }))
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
    .slice(0, STATS_TOP)

  const counts = new Map<string, StatsTrack>()
  for (const entry of plays) {
    const seen = counts.get(entry.id)
    if (seen) {
      seen.count += 1
      continue
    }
    counts.set(entry.id, { id: entry.id, title: entry.title, artist: entry.artist, count: 1 })
  }
  stats.tracks = counts.size
  stats.topTracks = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, STATS_TOP)

  for (const entry of plays) {
    const hour = new Date(entry.at).getHours()
    stats.hours[hour] += 1
  }
  let topHour = 0
  for (let hour = 1; hour < 24; hour += 1) {
    if (stats.hours[hour] > stats.hours[topHour]) topHour = hour
  }
  stats.topHour = stats.hours[topHour] > 0 ? topHour : null

  /*
   * 连续天数从今天往前数。今天还没听不算断：早上打开应用时 streak 不该归零，
   * 所以从昨天接着算——但再往前必须有一天真的听过，否则就是 0。
   */
  const heard = new Set(history.days.map((item) => item.day))
  let cursor = startOfDay(at)
  if (!heard.has(localDay(cursor))) cursor -= DAY_MS
  let streak = 0
  while (heard.has(localDay(cursor))) {
    streak += 1
    cursor -= DAY_MS
  }
  stats.streak = streak

  return stats
}

/** 「晚上 9 点」这种说法比 `21` 好读。 */
export function hourLabel(hour: number): string {
  const suffix = hour < 6 ? '凌晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : '晚上'
  const clock = hour % 12 === 0 ? 12 : hour % 12
  return `${suffix} ${clock} 点`
}
