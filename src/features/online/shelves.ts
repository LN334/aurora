import { useEffect, useMemo } from 'react'
import { useOnlineStore } from './store'
import type { ProviderId } from './types'

/**
 * 各平台的歌单，摊成一张表。
 *
 * 平台不是页面，是「这张单子从哪来」。所以这里只给数据，不给分区：主页和
 * 歌单页都拿同一份，谁需要谁自己决定怎么排。
 */
export interface ShelfCard {
  key: string
  providerId: ProviderId
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  creator: string
}

export const SHELF_PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'netease', label: '网易云音乐' },
  { id: 'qq', label: 'QQ 音乐' },
  { id: 'kugou', label: '酷狗音乐' },
  { id: 'qishui', label: '汽水音乐' }
]

/**
 * 四个平台的歌单。
 *
 * 调用次数写死成四：hooks 不能放在循环里，而平台表本来就是常量。多一个平台
 * 只改这里的调用行，漏掉一处 tsc 会提醒（下面 push 用的是同一组值）。
 */
export function useShelves(): ShelfCard[] {
  const netease = useOnlineStore('netease')()
  const qq = useOnlineStore('qq')()
  const kugou = useOnlineStore('kugou')()
  const qishui = useOnlineStore('qishui')()

  useEffect(() => {
    // 未接入的平台会回一个空壳，init 只是让它自己报「连不上」，不会抛出去。
    for (const platform of SHELF_PROVIDERS) {
      void useOnlineStore(platform.id).getState().init().catch(() => {})
    }
  }, [])

  return useMemo(() => {
    const rows: ShelfCard[] = []
    const push = (providerId: ProviderId, providerLabel: string, list: typeof netease.playlists) => {
      for (const playlist of list) {
        rows.push({
          key: providerId + ':' + playlist.id,
          providerId,
          providerLabel,
          id: playlist.id,
          name: playlist.name,
          coverUrl: playlist.coverUrl,
          trackCount: playlist.trackCount,
          creator: playlist.creator
        })
      }
    }
    push('netease', '网易云音乐', netease.playlists)
    push('qq', 'QQ 音乐', qq.playlists)
    push('kugou', '酷狗音乐', kugou.playlists)
    push('qishui', '汽水音乐', qishui.playlists)
    return rows
  }, [netease.playlists, qq.playlists, kugou.playlists, qishui.playlists])
}

/**
 * 四家轮着来。
 *
 * 直接拼起来的话，前面五十张全是网易云，别的平台在第二屏之后——看起来就像
 * 只接了一家。轮转之后第一行里四家都在，谁有内容一眼能看见。
 */
export function interleaveByProvider(rows: ShelfCard[]): ShelfCard[] {
  const buckets = new Map<ProviderId, ShelfCard[]>()
  for (const row of rows) {
    const bucket = buckets.get(row.providerId)
    if (bucket) bucket.push(row)
    else buckets.set(row.providerId, [row])
  }
  const lists = [...buckets.values()]
  const out: ShelfCard[] = []
  let index = 0
  for (;;) {
    let taken = false
    for (const list of lists) {
      const item = list[index]
      if (item) {
        out.push(item)
        taken = true
      }
    }
    if (!taken) return out
    index += 1
  }
}

/** 从某处开始取一段，越界绕回开头——「换一批」用同一份数据轮着看。 */
export function windowOf<T>(list: T[], start: number, size: number): T[] {
  if (list.length === 0) return []
  const out: T[] = []
  for (let i = 0; i < Math.min(size, list.length); i += 1) {
    out.push(list[(start + i) % list.length])
  }
  return out
}