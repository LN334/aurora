import { useEffect, useState } from 'react'
import type { Track } from '../../types'
import { useLikes } from '../favorites/likes'
import { getProvider, listAvailableProviders } from './registry'
import { useOnlineStore, type PlatformBackend } from './store'
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
        /*
         * 必须先把这家 store 叫起来：绑定当前档案、读出账号都发生在 init 里，
         * 跳过去直接取数据的话主进程还停在默认档案上，于是「未登录」。
         */
        await useOnlineStore(provider.id as never).getState().init().catch(() => {})
        const backend = (getProvider(provider.id)?.backend as PlatformBackend | undefined) ?? null
        if (!backend?.collection) return [] as Track[]
        const songs = await backend.collection('likes', 200)
        const tracks = songs.map((song: OnlineSong) => backend.toTrack(song))
        /*
         * 交一份给喜欢模块：列表上的心形按钮读的是那份缓存。不交的话，这一页
         * 里的歌在别处（播放条、详情页、跨平台合并的行）看着像没喜欢过。
         */
        useLikes.getState().seed(provider.id, tracks)
        return tracks
      } catch {
        return [] as Track[]
      }
    })
  )

  const tracks = lists.flat()
  cache = { at: Date.now(), tracks }
  return tracks
}

/** 收藏页要区分「还没读完」和「读完了是空的」——两者都长得像空列表，但只有一个该显示空态。 */
interface PlatformLikedState {
  tracks: Track[]
  loading: boolean
}

export function usePlatformLiked(): PlatformLikedState {
  const [state, setState] = useState<PlatformLikedState>(() =>
    cache ? { tracks: cache.tracks, loading: false } : { tracks: [], loading: true }
  )

  useEffect(() => {
    /*
     * 缓存还新鲜就直接用，不必再问一次上游；否则读一次，读完把 loading 落下来。
     * 从前这里只返回数组，于是「正在读」的那几百毫秒与「一首都没有」完全同形，
     * 收藏页先画一屏「还没有喜欢的歌」，数据到了再整页换掉——看着像先跳去了
     * 一个让人登录的页面。
     */
    if (cache && Date.now() - cache.at < TTL) return
    let alive = true
    void loadPlatformLiked()
      .then((next) => {
        if (alive) setState({ tracks: next, loading: false })
      })
      .catch(() => {
        if (alive) setState({ tracks: [], loading: false })
      })
    return () => {
      alive = false
    }
  }, [])

  return state
}
