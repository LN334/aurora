import type { Track } from '../../types.ts'
import { albumKeyOf } from './album-merge.ts'
import { supportsCapability } from './capability.ts'
import { getProvider, listAvailableProviders, sourceLabelById } from './registry.ts'
import type { PlatformBackend } from './store.ts'
import type { ProviderId } from './types.ts'
import { mergeVersions, primaryArtist, versionsMatch, versionKey } from './unify.ts'

/**
 * 专辑页的跨平台合并：同一张唱片在几家平台上各有一份时，收成一个页面。
 *
 * 与首页「推荐专辑」卡片（`mergeAlbumCards`）的区别在于证据来源：卡片只拿到
 * 名字和艺人，只能按归并键去重；专辑页手里有**整张曲目表**，可以用它当指纹。
 * 同名专辑多得很（同名首专、LIVE 版、精选），名字对得上不算数，得曲目也對得上。
 *
 * 找法不依赖「专辑搜索」。能按名字搜出专辑的实际上只有网易云一家：酷狗的搜索
 * 上游只给歌曲，QQ 只给歌曲，汽水没有专辑页。所以这里用**歌曲搜索**反查——
 * 按「专辑名 艺人名」搜，留下专辑名归一后相同、艺人认得出的那几首，再用曲目
 * 指纹确认是不是同一张。五家都能走这条路，靠的是它们都能搜歌。
 */

/** 曲目指纹至少要对上这么多首（主平台曲目更少时放宽）。 */
const MIN_SHARED = 2

/**
 * 合辑类专辑艺人：这类写法下面，曲目表里的歌手各是各的，拿专辑艺人对不上任何
 * 一首歌，硬比会把合辑全丢掉。
 */
const VARIOUS_ARTIST = /^(群星|合辑|精选|various artists?|va|unknown|未知)$/

/** 一张专辑在哪一家平台上的样子。 */
export interface AlbumOnPlatform {
  providerId: string
  /** 行内标签，取自 provider 的短名。 */
  label: string
  name: string
  artistName: string
  /** 这一家的曲目。 */
  tracks: Track[]
}

interface AlbumAcross {
  /** 主平台：页头的标题、年份、简介都取自这里。 */
  head: AlbumOnPlatform
  /** 这次在别家找回来的，曲目多的排在前面。 */
  others: AlbumOnPlatform[]
  /** 合并后的曲目：同一首跨平台合成一行，主平台的顺序在前。 */
  tracks: Track[]
}

/** 专辑名归一：与首页推荐卡片同一套规则（小写、去空白、全角括号半角化）。 */
export function albumNameKey(name: string): string {
  return albumKeyOf({ name: name ?? '', artistName: '' })
}

/**
 * 从一堆搜索结果里挑出属于这张专辑的歌。
 *
 * 两条都要：专辑名归一后相等，且曲目表里至少有一首认得出专辑艺人。艺人对不上
 * 就返回空——同名不同碟的可能性比漏合高得多。合辑（群星 / Various Artists）
 * 跳过第二条，那类专辑本来就没人对得上。
 *
 * 这里不做数量判断：搜索只给前一百首，一个平台索引里少了某首是常有的事，按数量
 * 卡会把真的专辑丢掉。数量与曲目指纹由 `albumAcrossPlatforms` 统一判。
 */
export function songsOfAlbum<
  T extends { name: string; album: { name: string }; artists: { name: string }[] }
>(albumName: string, albumArtist: string, songs: readonly T[]): T[] {
  const key = albumNameKey(albumName)
  if (!key || key === '|') return []
  const same = songs.filter((song) => albumNameKey(song.album?.name ?? '') === key)
  if (same.length === 0) return []

  const target = primaryArtist(albumArtist)
  if (!target || VARIOUS_ARTIST.test(target)) return same

  // 每一首都要认得出专辑艺人，不是「整批里有一首对得上」就算：同名专辑太多了
  // （《龙年》这种名字一年能出几十张），放行一批就等于把别人的碟收了进来。
  return same.filter((song) =>
    (song.artists ?? []).some((artist) => primaryArtist(artist.name) === target)
  )
}

/**
 * 两张曲目表里对得上几首。
 *
 * 判据与列表合并是同一套（`versionKey` + `versionsMatch`）：两处若各用一把尺子，
 * 会出现「页面说这是同一张、列表却把同一首拆成两行」的怪相。
 */
export function albumOverlap(head: readonly Track[], other: readonly Track[]): number {
  const buckets = new Map<string, Track[]>()
  for (const track of head) {
    const key = versionKey(track)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(track)
    else buckets.set(key, [track])
  }
  const counted = new Set<string>()
  for (const track of other) {
    const key = versionKey(track)
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (!bucket.some((candidate) => versionsMatch(candidate, track))) continue
    counted.add(`${key}|${Math.round(track.duration)}`)
  }
  return counted.size
}

/**
 * 曲目指纹是否对得上。
 *
 * 门槛随主平台曲目数收缩：一张只有 2 首的 EP，别家给出 2 首、对得上 1 首就算；
 * 一张 14 首的专辑，要求别家至少 3 首且指纹对上 2 首——否则「同名专辑」这五个字
 * 就足以骗过判断。
 */
export function albumFingerprintMatches(
  reference: readonly Track[],
  candidate: readonly Track[]
): boolean {
  if (candidate.length === 0) return false
  const needShared = Math.max(1, Math.min(MIN_SHARED, reference.length))
  if (albumOverlap(reference, candidate) < needShared) return false
  // 上界防的是另一种错：同名但不同的一张（精选、全集、另一版的同名碟）收了几十首
  // 进来，指纹恰好撞上两首就整批发过去。真专辑的两家曲目数差不了这么多。
  return candidate.length <= Math.max(4, reference.length * 2)
}

/**
 * 把一张专辑在别家平台上的版本找回来并合并。
 *
 * 每家的请求都独立失败：一家超时或拒答只是「这家没有」，不影响另外几家，也不
 * 影响主平台已经画出来的页面。
 */
export async function albumAcrossPlatforms(
  primary: AlbumOnPlatform,
  order: readonly string[]
): Promise<AlbumAcross> {
  const reference = primary.tracks

  const providers = listAvailableProviders().filter(
    (provider) => provider.id !== primary.providerId && supportsCapability(provider, 'search')
  )

  const rounds = await Promise.all(
    providers.map(async (provider): Promise<AlbumOnPlatform | null> => {
      const backend =
        (getProvider(provider.id as ProviderId)?.backend as PlatformBackend | undefined) ?? null
      const search = provider.search
      if (!backend || !search) return null
      try {
        const keywords = [primary.name, primary.artistName].filter(Boolean).join(' ')
        if (!keywords) return null
        const result = await search.search(keywords, 'song', 100)
        const matched = songsOfAlbum(primary.name, primary.artistName, result.songs)
        const toTrack = backend.toTrack as (song: never) => Track
        const tracks = matched.map((song) => toTrack(song as never))
        if (!albumFingerprintMatches(reference, tracks)) return null
        return {
          providerId: provider.id,
          label: sourceLabelById(provider.id),
          name: primary.name,
          artistName: primary.artistName,
          tracks
        }
      } catch {
        return null
      }
    })
  )

  const others = rounds
    .filter((round): round is AlbumOnPlatform => round !== null)
    .sort((a, b) => b.tracks.length - a.tracks.length)

  const tracks =
    others.length === 0
      ? primary.tracks
      : mergeVersions([...primary.tracks, ...others.flatMap((other) => other.tracks)], order)

  return { head: primary, others, tracks }
}
