import type { Track } from '../../types'

/**
 * 页面上出现过的曲目。
 *
 * 详情页的路由只带一个 id（#track/<id>），能查的只有本机库和最近听过这两张
 * 表。从歌单、每日推荐、搜索结果里点某首歌的「歌曲详情」，那首没播过就两张
 * 表都没有，于是落到「找不到这首歌」——那不是歌不存在，是没处查。
 *
 * 凡是列表渲染过的歌都在这里记一笔，详情页就有第三张表可查。只放内存不落盘：
 * 它兜的是「刚才在屏幕上见过」，重启后由列表重新填。
 */
const MAX = 800
const seen = new Map<string, Track>()

/** 记下一批列表里的曲目；重复的先删再插，让迭代顺序等于最近使用顺序。 */
export function rememberTracks(list: readonly Track[] | undefined): void {
  if (!list || list.length === 0) return
  for (const track of list) {
    if (!track || typeof track.id !== 'string' || track.id === '') continue
    seen.delete(track.id)
    seen.set(track.id, track)
  }
  if (seen.size <= MAX) return
  for (const key of seen.keys()) {
    if (seen.size <= MAX) break
    seen.delete(key)
  }
}

/** 查一首见过的歌；没有就返回 null，交给调用方继续往下找。 */
export function findSeenTrack(id: string): Track | null {
  return seen.get(id) ?? null
}
