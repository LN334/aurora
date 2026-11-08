/**
 * 听歌口味画像，以及按口味排的「今天听什么」。
 *
 * 每日推荐的池子一直是「本机 + 最近播放 + 各平台推荐」，但排序只有日期哈希——
 * 同一天稳定，和个人口味无关。这里补上画像：最近听过什么、喜欢过什么、这 30 天
 * 每个艺人听了多久。它只调排序权重，不改数据源，所以没有画像时行为和原来一样。
 *
 * 全程纯函数，测试在 tests/taste.test.ts。
 */
import type { Track } from '../../types'

export interface TasteProfile {
  /** 归一化后的主艺人 → 0..1，1 是听得最多的那个。 */
  artists: Record<string, number>
  /** 平台（或本机）→ 0..1。 */
  sources: Record<string, number>
  /** 参与统计的条目数；0 表示还没有画像。 */
  size: number
}

export interface TasteInput {
  /** 最近播放，最新在前。 */
  recent: { track?: Track; artist?: string; source?: string; at?: number }[]
  /** 我喜欢的曲目。 */
  liked: Track[]
  /** 历史里的每日统计（含每个艺人的收听秒数）。 */
  days: { artists: Record<string, number> }[]
}

/** FNV-1a，和每日推荐用同一个哈希，保证同一天同一批。 */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** 主艺人：一行有多个名字时，第一个才代表这张唱片是谁的。 */
export function primaryArtist(name: string): string {
  return (name.split(/[/\u3001&]|\sfeat\.?/i)[0] ?? '').trim().toLowerCase()
}

function artistKey(track: Track): string {
  return primaryArtist(track.artist || track.albumArtist || '')
}

function normalize(table: Record<string, number>): Record<string, number> {
  let max = 0
  for (const value of Object.values(table)) max = Math.max(max, value)
  if (max <= 0) return {}
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(table)) {
    if (key) out[key] = value / max
  }
  return out
}

export function buildTaste(input: TasteInput): TasteProfile {
  const artists: Record<string, number> = {}
  const sources: Record<string, number> = {}
  let size = 0

  const bump = (artist: string, source: string, weight: number) => {
    if (weight <= 0) return
    if (artist) artists[artist] = (artists[artist] ?? 0) + weight
    sources[source || 'local'] = (sources[source || 'local'] ?? 0) + weight
    size += 1
  }

  /* 1. 这 30 天每个艺人听了多久：一小时算一分，是最难伪造的口味证据。 */
  for (const day of input.days) {
    for (const [name, seconds] of Object.entries(day.artists ?? {})) {
      const key = primaryArtist(name)
      if (!key || !(seconds > 0)) continue
      artists[key] = (artists[key] ?? 0) + seconds / 3600
      size += 1
    }
  }

  /* 2. 最近播放：越新越重，第 20 条之后慢慢摊薄。 */
  input.recent.slice(0, 60).forEach((entry, index) => {
    const artist = entry.track ? artistKey(entry.track) : primaryArtist(entry.artist ?? '')
    bump(artist, entry.track?.source ?? entry.source ?? 'local', 1 / (1 + index / 20))
  })

  /* 3. 我喜欢的：明确表态，但一次喜欢不等于反复听。 */
  for (const track of input.liked.slice(0, 400)) {
    bump(artistKey(track), track.source ?? 'local', 1)
  }

  return { artists: normalize(artists), sources: normalize(sources), size }
}

export function affinityOf(profile: TasteProfile, track: Track): number {
  if (profile.size === 0) return 0
  const artist = profile.artists[artistKey(track)] ?? 0
  const source = profile.sources[track.source ?? 'local'] ?? 0
  /* 艺人远重于平台：听的是人，不是入口。 */
  return Math.min(1, artist * 0.85 + source * 0.15)
}

/** 每日一批：同一天同一批，但先照顾常听的人和平台。 */
export function tastefulDaily(
  pool: Track[],
  profile: TasteProfile,
  day = new Date(),
  size = 30
): Track[] {
  const seed = day.toDateString()
  const seen = new Set<string>()
  const ranked = pool
    .filter((track) => {
      if (!track || !track.id || seen.has(track.id)) return false
      seen.add(track.id)
      return true
    })
    .map((track) => ({
      track,
      /* 加权随机：口味分决定倾向，日期哈希决定同一天可复现的具体顺序。 */
      score: affinityOf(profile, track) * 0.65 + (hash(seed + '|' + track.id) / 4294967296) * 0.35
    }))
    .sort((a, b) => b.score - a.score)

  /* 一个艺人最多两首：画像再集中，也不该整页都是同一个人。 */
  const out: Track[] = []
  const perArtist = new Map<string, number>()
  for (const item of ranked) {
    if (out.length >= size) break
    const key = artistKey(item.track)
    const used = perArtist.get(key) ?? 0
    if (key && used >= 2) continue
    perArtist.set(key, used + 1)
    out.push(item.track)
  }
  /* 池子里人太少时放宽上限，宁可重复艺人也要凑够一批。 */
  if (out.length < size) {
    for (const item of ranked) {
      if (out.length >= size) break
      if (out.some((picked) => picked.id === item.track.id)) continue
      out.push(item.track)
    }
  }
  return out
}

export function tasteTopArtists(profile: TasteProfile, limit = 5): { artist: string; weight: number }[] {
  return Object.entries(profile.artists)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([artist, weight]) => ({ artist, weight }))
}
