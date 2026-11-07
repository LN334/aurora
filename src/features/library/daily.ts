import type { Track } from '../../types'

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

export function dailyTracks(pool: Track[], day = new Date(), size = DAILY_SIZE): Track[] {
  const seed = day.toDateString()
  return pool
    .map((track) => ({ track, rank: hash(seed + track.id) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, size)
    .map((item) => item.track)
}

export function dailyLabel(day = new Date()): string {
  return `${day.getMonth() + 1} 月 ${day.getDate()} 日`
}
