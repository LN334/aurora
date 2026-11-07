import type { Track } from '../../types'

/**
 * 多平台合并：把「同一首歌」在几个平台上的版本收成一行。
 *
 * 合并只认全等，不猜相似度——错把两个版本并成一个，用户点播放会听见另一首
 * 歌，这比多一行难查得多。所以三个条件同时成立才算同一首：
 *
 * 1. 标题归一后相等（去掉 feat. 段、大小写、空白、全角差异）；
 * 2. 主艺人归一后相等（只比第一个艺人：合唱曲在两家平台的艺人顺序常常不同，
 *    比全部艺人会把同一首拆成两行）；
 * 3. 时长落在同一档（每 5 秒一档，等价于 ±2 秒容差）。
 *
 * 时长未知（0）时只按前两条合并：宁可偶有多版本并一起，也不把同一首拆开。
 */

/** 艺人之间的分隔写法：两家平台都用这些。 */
const ARTIST_SEPARATORS = /\s*[/、,;&]\s*/

/** 标题里的客串段：合并时不算标题的一部分。 */
const FEAT = /\s*[(\[（【]\s*(feat|ft|featuring)\.?\s[^)\]）】]*[)\]）】]\s*/gi

/** 全角转半角，再小写、压空白。 */
export function normalizeName(value: string): string {
  return (value || '')
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[()（）\[\]【】]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeTitle(title: string): string {
  return normalizeName((title || '').replace(FEAT, ' '))
}

export function primaryArtist(artist: string): string {
  const first = (artist || '').split(ARTIST_SEPARATORS)[0] ?? ''
  return normalizeName(first)
}

/** 时长档：每 5 秒一档。0 表示未知，单独成一档，不与任何已知时长合并。 */
export function durationBucket(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.round(seconds / 5)
}

/** 一首歌的合并键。 */
export function trackKey(track: Track): string {
  const bucket = durationBucket(track.duration)
  return `${normalizeTitle(track.title)}|${primaryArtist(track.artist)}|${bucket}`
}

/**
 * 主行顺序：用户设定的音源优先级。
 *
 * 没设过就按「本机优先，其次网易云，其次 QQ，再次酷狗」——本机文件不需要联网、
 * 也不需要会员，先试它是唯一不会白等一次请求的选择。
 */
export const DEFAULT_SOURCE_ORDER = ['local', 'netease', 'qq', 'kugou'] as const

function rank(source: string | undefined, order: readonly string[]): number {
  const index = order.indexOf(source ?? 'local')
  return index === -1 ? order.length : index
}

/**
 * 合并重复版本。
 *
 * 输出的第一项是主行（优先级最高的版本），其余版本挂到 `versions`。同一个
 * 平台出现两次（例如同一首歌在两个歌单里）只保留第一次，避免一行里挂两个
 * 一模一样的版本。
 */
export function mergeVersions(tracks: Track[], order: readonly string[] = DEFAULT_SOURCE_ORDER): Track[] {
  const groups = new Map<string, Track[]>()

  for (const track of tracks) {
    const key = trackKey(track)
    const group = groups.get(key)
    if (group) group.push(track)
    else groups.set(key, [track])
  }

  const merged: Track[] = []
  for (const group of groups.values()) {
    const seen = new Set<string>()
    const unique = group.filter((track) => {
      const id = `${track.source ?? 'local'}:${track.onlineId ?? track.id}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    unique.sort((a, b) => rank(a.source, order) - rank(b.source, order))
    const [head, ...rest] = unique
    if (!head) continue
    merged.push(rest.length > 0 ? { ...head, versions: rest } : head)
  }

  return merged
}

/** 这一行涉及的全部平台（含主行自己），按给定优先级去重。 */
export function sourcesOf(track: Track, order: readonly string[] = DEFAULT_SOURCE_ORDER): string[] {
  const all = [track, ...(track.versions ?? [])].map((item) => item.source ?? 'local')
  const unique = [...new Set(all)]
  unique.sort((a, b) => rank(a, order) - rank(b, order))
  return unique
}

/** 这一行里属于某个平台的版本（主行自己也在其中）。 */
export function versionsOf(track: Track, source: string): Track[] {
  return [track, ...(track.versions ?? [])].filter((item) => (item.source ?? 'local') === source)
}
