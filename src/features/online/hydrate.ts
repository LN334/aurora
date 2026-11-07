import type { Track } from '../../types'
import { getProvider } from './registry'
import type { PlatformBackend } from './store'
import type { ProviderId } from './types'

/**
 * 给旧记录补回艺人 id。
 *
 * 播放历史里存的是播放当时的曲目快照。artistRefs 是后加的字段，所以老记录
 * 是一条名字串、点不开；而最近播放页恰恰最想点歌手。这里按 onlineId 回查
 * 一次平台，把每个歌手的 id 拿回来。查不到就算了，不挡列表渲染。
 */

type ArtistRef = { id: number; name: string }

const cache = new Map<string, ArtistRef[]>()

async function refsForOne(track: Track): Promise<ArtistRef[]> {
  const key = `${track.source}:${track.onlineId}`
  const hit = cache.get(key)
  if (hit) return hit
  const backend = (getProvider(track.source as ProviderId)?.backend as PlatformBackend | undefined) ?? null
  if (!backend || !track.onlineId) return []
  try {
    const song = await backend.songById(track.onlineId)
    const refs = (song?.artists ?? []).map((item) => ({ id: item.id || 0, name: item.name }))
    if (refs.length > 0) cache.set(key, refs)
    return refs
  } catch {
    return []
  }
}

export async function hydrateArtistRefs(tracks: Track[]): Promise<Track[]> {
  const need = tracks.filter(
    (track) => !track.artistRefs?.length && track.source && track.source !== 'local' && track.onlineId
  )
  if (need.length === 0) return tracks
  const found = new Map<string, ArtistRef[]>()
  await Promise.all(
    need.map(async (track) => {
      const refs = await refsForOne(track)
      if (refs.length > 0) found.set(track.id, refs)
    })
  )
  if (found.size === 0) return tracks
  return tracks.map((track) => {
    const refs = found.get(track.id)
    return refs ? { ...track, artistRefs: refs } : track
  })
}
