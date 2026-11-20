import { useEffect, useState } from 'react'
import type { Track } from '../../types'
import { onLikesChanged, useLikes } from '../favorites/likes'
import { foldLikedParts, likedCacheTtl, type LikedFold, type LikedPart } from './liked-merge'
import { getProvider, listAvailableProviders } from './registry'
import { useOnlineStore, type PlatformBackend } from './store'
import type { OnlineSong, ProviderId } from './types'

/**
 * 各平台账号里「我喜欢的」。
 *
 * 它和本地点过心的那堆是同一种东西，所以收藏页把两边并成一张列表：平台只当
 * 徽章，不当分区。十分钟缓存一次——上游按账号限流，翻来翻去没必要每次都问。
 * 有平台没问出来时那份缓存只活三十秒，见 likedCacheTtl。
 */

/*
 * 窗口在后台待了一段时间再回来：用户很可能刚在平台自己的 App 里点过心。
 * 一分钟内不重复问（同一分钟里切来切去不值得各拉一遍两百首）。
 */
const FOCUS_TTL = 60 * 1000

/*
 * 按「问了哪几家」分份缓存：收藏页要四家全量，漫游只该拿勾选的那几家。
 * 键 '*' 是全量。
 */
const cache = new Map<string, { at: number; tracks: Track[]; failed: number }>()

/*
 * 缓存被作废时要叫醒正在看这一页的人。心形按钮与这一页读的不是同一份数据：
 * 点完心不同步，用户得等十分钟过期、或者重启应用才能看到结果。
 */
const listeners = new Set<() => void>()

/** 把缓存丢掉，下一次读走一趟网络。喜欢动作之后、窗口回到前台时调它。 */
export function invalidatePlatformLiked(): void {
  cache.clear()
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // 一个订阅者出错不该让别人收不到。
    }
  }
}

/**
 * 每家自己失败就自己空着，一家登不上不该让整页变白。
 *
 * 传了 `platforms` 就只问这几家；不传是全量。没被问到的平台连 `init` 都不跑，
 * 后端不会为它起来。
 *
 * 返回值带一份 `failed`：几家没问出来。空列表有两种意思——「读完了，确实没有」
 * 与「没读到」，界面必须分得开。2026-11-17 那次就是这样：上游 502 断了两秒，首页
 * 把「没读到」画成了「我喜欢的音乐 0 首」。
 */
async function loadPlatformLiked(
  platforms?: ProviderId[],
  onPart?: (fold: LikedFold, done: number, total: number) => void
): Promise<LikedFold> {
  const key = platforms ? [...platforms].sort().join(',') : '*'
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < likedCacheTtl(hit.failed)) {
    return { tracks: hit.tracks, failed: hit.failed }
  }
  const wanted = platforms ? new Set(platforms) : null

  const providers = listAvailableProviders().filter(
    (provider) =>
      Boolean(provider.capabilities.likes) && (wanted === null || wanted.has(provider.id))
  )
  const total = providers.length
  const parts: LikedPart[] = []

  /*
   * 一家读回来就先交一次，不等四家到齐。
   *
   * 从前这里是 `Promise.all`：哪家慢，整页就等哪家。网易云这个接口慢起来是
   * 十几秒，于是收藏页在数据其实早就到齐的情况下一直停在「正在读取各平台的收藏…」；
   * 用户看到的是「我的喜欢没了」。现在慢的那家自己慢，别的先上屏。
   */
  const lists = await Promise.all(
    providers.map(async (provider): Promise<LikedPart> => {
      let part: LikedPart
      try {
        /*
         * 必须先把这家 store 叫起来：绑定当前档案、读出账号都发生在 init 里，
         * 跳过去直接取数据的话主进程还停在默认档案上，于是「未登录」。
         */
        await useOnlineStore(provider.id as never).getState().init().catch(() => {})
        const impl = getProvider(provider.id)
        const backend = (impl?.backend as PlatformBackend | undefined) ?? null
        /*
         * 分三种：注册表没这家（启动那一瞬）、有这家但后端还没接上、有后端但没有
         * 喜欢这条通道。前两种是「这次没问到」，第三种是「这家本来就没有」——
         * 混成一个会让一次冷启动报出「1 家没读到」，而其实什么都没坏。
         */
        if (!impl || !backend) {
          part = { tracks: [], failed: true }
        } else if (!backend.collection) {
          /*
           * 这家不支持喜欢：空结果，不算失败。
           */
          part = { tracks: [], failed: false }
        } else {
          const songs = await backend.collection('likes', 200)
          /*
           * 一首坏数据不该毁掉整份收藏。
           *
           * `map` 里抛一个异常，581 首就一起没了，页面只好说「没读到」——而其实
           * 只坏了一首。逐条转，坏的跳过并留一句，其余照常上屏。
           */
          const tracks: Track[] = []
          for (const song of songs as OnlineSong[]) {
            try {
              tracks.push(backend.toTrack(song))
            } catch (error) {
              console.warn('[liked] ' + provider.id + ' 跳过一条坏数据：', error)
            }
          }
          /*
           * 交一份给喜欢模块：列表上的心形按钮读的是那份缓存。不交的话，这一页
           * 里的歌在别处（播放条、详情页、跨平台合并的行）看着像没喜欢过。
           */
          useLikes.getState().seed(provider.id, tracks)
          part = { tracks, failed: false }
        }
      } catch (error) {
        /*
         * 一个平台整份读失败时留一句。收藏页只会说「N 家没读到」，
         * 到底是哪家、错在哪，靠这一行；否则排查只能靠猜。
         */
        console.warn('[liked] ' + provider.id + ' 读取失败：', error)
        part = { tracks: [], failed: true }
      }
      parts.push(part)
      try {
        onPart?.(foldLikedParts(parts), parts.length, total)
      } catch {
        // 一次上屏失败不该让整趟读取失败。
      }
      return part
    })
  )

  const fold = foldLikedParts(lists)
  cache.set(key, { at: Date.now(), tracks: fold.tracks, failed: fold.failed })
  return fold
}

/**
 * 收藏页要区分三种空：还没读完、读完了是空的、没读到。
 * 三者都长得像空列表，但只有一个该显示「还没有喜欢的歌」。
 */
interface PlatformLikedState {
  tracks: Track[]
  loading: boolean
  /** 这一趟有几家没问出来。0 才是「真的读完了」。 */
  failed: number
  /** 还在读的还有几家。逐家上屏之后，页面靠它说「还有 2 家在读」，而不是整页空白。 */
  pending: number
}

/**
 * 传了 `platforms` 就只问这几家。首页那张「我喜欢的音乐」卡传的是用户勾选的推流
 * 平台——否则启动时会为了一个数字把四家后端全拉起来。收藏页不传，仍是四家全量。
 */
export function usePlatformLiked(platforms?: ProviderId[]): PlatformLikedState {
  const key = platforms ? [...platforms].sort().join(',') : '*'
  const [state, setState] = useState<PlatformLikedState>(() => {
    const hit = cache.get(key)
    return hit
      ? { tracks: hit.tracks, loading: false, failed: hit.failed, pending: 0 }
      : { tracks: [], loading: true, failed: 0, pending: 0 }
  })

  useEffect(() => {
    let alive = true
    const ids = key === '*' ? undefined : (key.split(',') as ProviderId[])

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
      const hit = cache.get(key)
      if (hit && Date.now() - hit.at < likedCacheTtl(hit.failed)) {
        if (alive) setState({ tracks: hit.tracks, loading: false, failed: hit.failed, pending: 0 })
        return
      }
      if (alive) {
        setState((prev) => ({
          tracks: keep ? prev.tracks : [],
          loading: true,
          failed: prev.failed,
          pending: prev.pending
        }))
      }
      void loadPlatformLiked(ids, (fold, done, total) => {
        /*
         * 半份也上屏：到一家画一家，loading 只在还差人家时留着。
         * 慢的那家（多半是网易云）自己转，页面已经能看能放了。
         */
        if (!alive) return
        setState({ tracks: fold.tracks, loading: done < total, failed: fold.failed, pending: total - done })
      })
        .then((next) => {
          if (alive) setState({ tracks: next.tracks, loading: false, failed: next.failed, pending: 0 })
        })
        .catch(() => {
          /*
           * 这一次没读到不代表喜欢被删了：保留上一份，并把失败数抬起来，
           * 让界面说「没读到」而不是「你没有」。
           */
          if (alive) {
            setState((prev) => ({
              tracks: prev.tracks,
              loading: false,
              failed: prev.failed + 1,
              pending: 0
            }))
          }
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
  }, [key])

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
    const hit = cache.get('*')
    if (hit && Date.now() - hit.at < FOCUS_TTL) return
    invalidatePlatformLiked()
  })
}
