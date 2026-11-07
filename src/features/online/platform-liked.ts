import { useEffect, useState } from 'react'
import type { Track } from '../../types'
import { getProvider, listAvailableProviders } from './registry'
import type { PlatformBackend } from './store'
import type { OnlineSong } from './types'

/**
 * 各平台账号里「我喜欢的」。
 *
 * 它和本地点过心的那堆是同一种东西，所以收藏页把两边并成一张列表：平台只当
 * 徽章，不当分区。十分钟缓存一次——上游按账号限流，翻来翻去没必要每次都问。
 */
const TTL = 10 * 60 * 1000
let cache: { at: number; tracks: Track[] } | null = null

/** 每家自己失败就自己空着，一家登不上不该让整页变白。 */
export async function loadPlatformLiked(): Promise<Track[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.tracks

  const providers = listAvailableProviders().filter((provider) => provider.capabilities.likes)
  const lists = await Promise.all(
    providers.map(async (provider) => {
      try {
        const backend = (getProvider(provider.id)?.backend as PlatformBackend | undefined) ?? null
        if (!backend?.collection) return [] as Track[]
        const songs = await backend.collection('likes', 200)
        return songs.map((song: OnlineSong) => backend.toTrack(song))
      } catch {
        return [] as Track[]
      }
    })
  )

  const tracks = lists.flat()
  cache = { at: Date.now(), tracks }
  return tracks
}

export function usePlatformLiked(): Track[] {
  const [tracks, setTracks] = useState<Track[]>(() => cache?.tracks ?? [])

  useEffect(() => {
    let alive = true
    void loadPlatformLiked()
      .then((next) => {
        if (alive) setTracks(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  return tracks
}
