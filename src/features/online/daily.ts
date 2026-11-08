import { useEffect, useState } from 'react'
import type { Track } from '../../types'
import { getProvider, listAvailableProviders } from './registry'
import { useOnlineStore, type PlatformBackend } from './store'
import type { ProviderId } from './types'
import { mergeVersions } from './unify'
import { sourceOrder } from '../settings/source-order'

/**
 * 各平台的每日推荐。
 *
 * 只问声明了 recommendations.dailySongs 的平台：网易云有，QQ 也声明了（上游
 * 把 uin 写死成 0，实际常常是空——空就不占位置，不影响别家）。酷狗与汽水没有
 * 这个集合，汽水的 feed 还要登录且按场景走，等账号体系稳定再接。
 *
 * 十分钟缓存一次：上游按账号限流，一天之内其实只该取一次，但用户可能同一会话
 * 里反复进出首页，缓存一层比每次重启都问一遍稳妥。
 */
const TTL = 10 * 60 * 1000
let cache: { at: number; tracks: Track[] } | null = null

/** 每家自己失败就自己空着，一个平台登不上不该让整块推荐变白。 */
export async function loadPlatformDaily(): Promise<Track[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.tracks

  const providers = listAvailableProviders().filter((provider) =>
    Boolean(provider.recommendations?.dailySongs)
  )
  const lists = await Promise.all(
    providers.map(async (provider) => {
      try {
        // 同上：绑定档案在 init 里，跳过它上游会当游客。
        await useOnlineStore(provider.id as never).getState().init().catch(() => {})
        const backend =
          (getProvider(provider.id as ProviderId)?.backend as PlatformBackend | undefined) ?? null
        const daily = provider.recommendations?.dailySongs
        if (!backend || !daily) return [] as Track[]
        const songs = await daily()
        return songs.map((song) => backend.toTrack(song))
      } catch {
        return [] as Track[]
      }
    })
  )

  const tracks = mergeVersions(lists.flat(), sourceOrder())
  cache = { at: Date.now(), tracks }
  return tracks
}

export function usePlatformDaily(): Track[] {
  const [tracks, setTracks] = useState<Track[]>(() => cache?.tracks ?? [])

  useEffect(() => {
    let alive = true
    void loadPlatformDaily()
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
