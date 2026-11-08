import { useEffect, useState } from 'react'
import type { Track } from '../../types'
import { getProvider, listAvailableProviders } from './registry'
import { useOnlineStore, type PlatformBackend } from './store'
import type { ProviderId } from './types'
import { mergeVersions } from './unify'
import { sourceOrder } from '../settings/source-order'
import { useRoamPlatforms } from '../player/roam-sources'

/**
 * 各平台的每日推荐。
 *
 * 只问声明了 recommendations.dailySongs 的平台：网易云有；QQ 也声明了（上游把
 * uin 写死成 0，实际常常是空——空就不占位置）；酷狗的 `/recommend/songs` 游客
 * 也给 30 首。汽水的 feed 要 session，等账号体系稳定再接。
 *
 * 十分钟缓存一次：上游按账号限流，一天之内其实只该取一次，但用户可能同一会话
 * 里反复进出首页，缓存一层比每次重启都问一遍稳妥。
 */
const TTL = 10 * 60 * 1000

/**
 * 缓存按「问了哪几家」分开存。
 *
 * 用户在设置里勾掉一家，首页那份就该少一家；漫游按当时的勾选现拉。两份若共用
 * 一格缓存，先后打开会互相顶掉，所以键是平台集合本身。
 */
const caches = new Map<string, { at: number; tracks: Track[] }>()

/**
 * 每家自己失败就自己空着，一个平台登不上不该让整块推荐变白。
 *
 * 传 `platforms` 就是只问这几家；不传就是全问。两种走同一套缓存，键不同。
 */
export async function loadPlatformDaily(platforms?: ProviderId[]): Promise<Track[]> {
  const cacheKey = platforms ? [...platforms].sort().join(',') : '*'
  const cached = caches.get(cacheKey)
  if (cached && Date.now() - cached.at < TTL) return cached.tracks
  const wanted = platforms ? new Set(platforms) : null

  const providers = listAvailableProviders().filter(
    (provider) =>
      Boolean(provider.recommendations?.dailySongs) && (wanted === null || wanted.has(provider.id))
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
  caches.set(cacheKey, { at: Date.now(), tracks })
  return tracks
}

/**
 * 首页与每日推荐页共用这一支。
 *
 * 问哪几家跟着设置里那份勾选走（roam-sources 是唯一真源）；勾选变了就重拉，
 * 缓存按集合分开，所以来回改不会拿到上一份的结果。
 */
export function usePlatformDaily(): Track[] {
  const chosen = useRoamPlatforms()
  const [tracks, setTracks] = useState<Track[]>(() => caches.get(chosen.slice().sort().join(','))?.tracks ?? [])

  useEffect(() => {
    let alive = true
    void loadPlatformDaily(chosen)
      .then((next) => {
        if (alive) setTracks(next)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [chosen])

  return tracks
}
