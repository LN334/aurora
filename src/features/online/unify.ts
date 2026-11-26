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
 * 3. 时长相差不超过 2.5 秒。
 *
 * 第三条曾经是「每 5 秒一档」的桶比较，那样 127 与 128 会落进两档，同一首歌被拆
 * 成两行。现在先按前两条分组，再在组内按时长分簇。
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

function normalizeTitle(title: string): string {
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

/**
 * 一首歌的合并键（不带时长）。
 *
 * 时长不参与分组：上游报的秒数各差一点是常态，127 与 128 在 5 秒一档里会落到
 * 两档，同一首歌就并成了两行。时长放到桶内比较，见 `versionsMatch`。
 */
export function versionKey(track: Track): string {
  return `${normalizeTitle(track.title)}|${primaryArtist(track.artist)}`
}

/** 同一首的两个版本，时长最多差这么多秒。 */
const DURATION_TOLERANCE = 2.5

/**
 * 两个版本是不是同一首。
 *
 * 时长未知（0）只与同为未知的配对：未知与 3 分 20 秒谈不上「差两秒内」，让它们
 * 合并等于让所有时长缺失的歌互相吞掉。
 */
export function versionsMatch(a: Track, b: Track): boolean {
  if (!a.duration || !b.duration) return !a.duration && !b.duration
  return Math.abs(a.duration - b.duration) <= DURATION_TOLERANCE
}

/** 一首歌的合并键，含时长档。给只做「键相等」比较的调用方用。 */
export function trackKey(track: Track): string {
  return `${versionKey(track)}|${durationBucket(track.duration)}`
}

/**
 * 主行顺序：用户设定的音源优先级。
 *
 * 没设过就按「本机优先，其次网易云，其次 QQ，再次酷狗」——本机文件不需要联网、
 * 也不需要会员，先试它是唯一不会白等一次请求的选择。
 */
const DEFAULT_SOURCE_ORDER = ['local', 'netease', 'qq', 'kugou'] as const

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
  const buckets = new Map<string, Track[]>()

  for (const track of tracks) {
    const key = versionKey(track)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(track)
    else buckets.set(key, [track])
  }

  // 同一个「标题 + 艺人」下可能真的有两首（原版与现场），所以再按时长分簇。
  const groups = [...buckets.values()].flatMap(clusterByDuration)

  const merged: Track[] = []
  for (const group of groups) {
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

/** 桶内按时长分簇：第一首当锚，与锚差不超过容差的归同一簇。 */
function clusterByDuration(bucket: readonly Track[]): Track[][] {
  const clusters: Track[][] = []
  for (const track of bucket) {
    let placed = false
    for (const cluster of clusters) {
      const anchor = cluster[0]
      if (anchor && versionsMatch(anchor, track)) {
        cluster.push(track)
        placed = true
        break
      }
    }
    if (!placed) clusters.push([track])
  }
  return clusters
}

/** 这一行涉及的全部平台（含主行自己），按给定优先级去重。 */
export function sourcesOf(track: Track, order: readonly string[] = DEFAULT_SOURCE_ORDER): string[] {
  const all = [track, ...(track.versions ?? [])].map((item) => item.source ?? 'local')
  const unique = [...new Set(all)]
  unique.sort((a, b) => rank(a, order) - rank(b, order))
  return unique
}
