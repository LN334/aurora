import type { Track } from '../../types'
import { tastefulDaily, type TasteProfile } from './taste.ts'

/**
 * 每日推荐的那一批歌。
 *
 * 规则只有一条：同一天打开是同一批，第二天换掉。所以种子是日期本身，
 * 排序用种子加曲目 id 的哈希——不随机、不存状态，重开窗口也不会变。
 *
 * 现在池子是「本机曲库，没有就退到最近播放」。等网易云的每日推荐接口接上，
 * 换的是这里的取数，页面和样式都不用动。
 */

/** FNV-1a：短、稳定、不需要依赖。 */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const DAILY_SIZE = 30

export function dailyTracks(
  pool: Track[],
  day = new Date(),
  size = DAILY_SIZE,
  profile?: TasteProfile
): Track[] {
  /* 有画像就按口味排；没有（新用户、刚清空历史）保持纯日期哈希。 */
  if (profile && profile.size > 0) return tastefulDaily(pool, profile, day, size)
  const seed = day.toDateString()
  return pool
    .map((track) => ({ track, rank: hash(seed + track.id) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, size)
    .map((item) => item.track)
}

/**
 * 按来源交错。
 *
 * 四家各推各的一批，直接拼起来就是「先网易云三十首、再 QQ 三十首」——第一屏
 * 全是一个平台，看起来像只接了一家。轮转之后第一行四家都有。
 */
export function interleaveBySource(tracks: Track[]): Track[] {
  const buckets = new Map<string, Track[]>()
  for (const track of tracks) {
    const key = track.source ?? 'local'
    const bucket = buckets.get(key)
    if (bucket) bucket.push(track)
    else buckets.set(key, [track])
  }
  const lists = [...buckets.values()]
  const longest = lists.reduce((max, rows) => Math.max(max, rows.length), 0)
  const out: Track[] = []
  for (let at = 0; at < longest; at += 1) {
    for (const rows of lists) {
      const next = rows[at]
      if (next) out.push(next)
    }
  }
  return out
}

export function dailyLabel(day = new Date()): string {
  return `${day.getMonth() + 1} 月 ${day.getDate()} 日`
}
