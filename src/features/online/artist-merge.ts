import type { Track } from '../../types'
import { supportsCapability } from './capability'
import { listAvailableProviders } from './registry'
import { normalizeName } from './unify'
import { collectTracks } from './collect'

/**
 * 同一位艺人在别的平台上的歌。
 *
 * 艺人页此前只认当前平台，网易云的 The Weeknd 和 QQ 的 The Weeknd 是两个页面。
 * 这里按名字去其它平台搜一遍，只留艺人名完全对得上的，再并回当前平台——页面
 * 因此是「这个人的歌」，平台退到行尾当徽章。
 */
export async function songsAcrossPlatforms(
  name: string,
  order: readonly string[],
  exclude?: string,
  /** 只问这几家。不传就是全部能搜的——艺人页要的是「这个人在所有平台上的歌」。 */
  only?: ReadonlySet<string>
): Promise<Track[]> {
  const target = normalizeName(name)
  if (!target) return []
  const providers = listAvailableProviders().filter(
    (provider) =>
      provider.id !== exclude && supportsCapability(provider, 'search') && (!only || only.has(provider.id))
  )
  return collectTracks(providers, order, async (provider, backend) => {
    const search = provider.search
    if (!search) return []
    const result = await search.search(name, 'song', 40)
    const songs = result.songs.filter((song) =>
      song.artists.some((artist) => normalizeName(artist.name) === target)
    )
    const toTrack = backend.toTrack as (song: never) => Track
    return songs.map((song) => toTrack(song as never))
  })
}
