import { useEffect, useState } from 'react'
import type { Track } from '../../types'
import { onLikesChanged, useLikes } from '../favorites/likes'
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

/*
 * 窗口在后台待了一段时间再回来：用户很可能刚在平台自己的 App 里点过心。
 * 一分钟内不重复问（同一分钟里切来切去不值得各拉一遍两百首）。
 */
const FOCUS_TTL = 60 * 1000

let cache: { at: number; tracks: Track[] } | null = null

/*
 * 缓存被作废时要叫醒正在看这一页的人。心形按钮与这一页读的不是同一份数据：
 * 点完心不同步，用户得等十分钟过期、或者重启应用才能看到结果。
 */
const listeners = new Set<() => void>()

/** 把缓存丢掉，下一次读走一趟网络。喜欢动作之后、窗口回到前台时调它。 */
export function invalidatePlatformLiked(): void {
  cache = null
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // 一个订阅者出错不该让别人收不到。
    }
  }
}

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
    let alive = true

    /*
     * 缓存还新鲜就直接用，不必再问一次上游；否则读一次，读完把 loading 落下来。
     * 从前这里只返回数组，于是「正在读」的那几百毫秒与「一首都没有」完全同形，
     * 收藏页先画一屏「还没有喜欢的歌」，数据到了再整页换掉——看着像先跳去了
     * 一个让人登录的页面。
     *
     * `keep` 是给重读用的：缓存作废后重新拉的那一秒里，把已读到的列表留在屏幕上，
     * 只把 loading 亮起来。清空再填会让人以为收藏被删了。
     */
    const read = (keep: boolean): void => {
      if (cache && Date.now() - cache.at < TTL) {
        if (alive) setState({ tracks: cache.tracks, loading: false })
        return
      }
      if (alive) setState((prev) => ({ tracks: keep ? prev.tracks : [], loading: true }))
      void loadPlatformLiked()
        .then((next) => {
          if (alive) setState({ tracks: next, loading: false })
        })
        .catch(() => {
          // 这一次没读到不代表喜欢被删了，保留上一份，别把页面清空。
          if (alive) setState((prev) => ({ tracks: prev.tracks, loading: false }))
        })
    }

    read(false)
    const onChange = (): void => {
      read(true)
    }
    listeners.add(onChange)
    return () => {
      alive = false
      listeners.delete(onChange)
    }
  }, [])

  return state
}

/*
 * 点完心就叫这一页重读。订阅放在模块顶层：它只在应用活着的整段时间里有意义，
 * 跟某个组件挂没挂上无关。
 */
onLikesChanged(() => {
  invalidatePlatformLiked()
})

/*
 * 窗口回到前台时也看一眼。用户可能刚在网易云手机端点了心，切回来应当能看到；
 * 一分钟内不重复问，免得来回点两次窗口就各拉一遍。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (cache && Date.now() - cache.at < FOCUS_TTL) return
    invalidatePlatformLiked()
  })
}
