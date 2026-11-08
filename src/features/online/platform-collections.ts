import { useEffect, useState } from 'react'
import { useOnlineStore } from './store'
import type { ProviderId } from './types'

/**
 * 平台上的「收藏」：只做专辑。
 *
 * 歌单不在这里。歌单有归属之分（自己建的 / 从别人那里收的 / 平台分不出来的），
 * 那套判定连同卡片形状一起搬进了 `playlist-cards.ts`；这里只剩收藏专辑，它没有
 * 归属问题——收藏来的就是收藏来的。
 *
 * 收藏关系只存在于平台账号里，所以这一页的数据一律按账号来，未登录就是空。
 */

export interface CollectedAlbum {
  key: string
  providerId: ProviderId
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  artistName: string
  year: number
  songCount: number
}

/**
 * 收藏的专辑，各家平台合在一起。
 *
 * 只有网易云和 QQ 有这条通道：酷狗和汽水没有「收藏专辑」这种关系，未登录的
 * 平台也交不出任何东西。拿不到的平台直接不出现，而不是占一块写着「暂无」的
 * 空位——那会让「本来就没有」看起来像「没加载出来」。
 */
export function useCollectedAlbums(): CollectedAlbum[] {
  const neteaseAccount = useOnlineStore('netease')((state) => state.account)
  const qqAccount = useOnlineStore('qq')((state) => state.account)
  const [rows, setRows] = useState<CollectedAlbum[]>([])

  useEffect(() => {
    let alive = true
    const loads: Promise<CollectedAlbum[]>[] = []

    const netease = window.aurora?.netease
    if (netease?.albumSublist) {
      loads.push(
        netease
          .albumSublist()
          .then((list) =>
            list.map((album) => ({
              key: 'netease:' + album.id,
              providerId: 'netease' as ProviderId,
              providerLabel: '网易云音乐',
              id: album.id,
              name: album.name,
              coverUrl: album.coverUrl,
              artistName: album.artistName,
              year: album.year,
              songCount: album.songCount
            }))
          )
          .catch(() => [])
      )
    }

    const qq = window.aurora?.qq
    if (qq?.collectedAlbums) {
      loads.push(
        qq
          .collectedAlbums()
          .then((list) =>
            list.map((album) => ({
              key: 'qq:' + album.id,
              providerId: 'qq' as ProviderId,
              providerLabel: 'QQ 音乐',
              id: album.id,
              name: album.name,
              coverUrl: album.coverUrl,
              artistName: album.artistName,
              year: album.year ?? 0,
              songCount: album.songCount
            }))
          )
          .catch(() => [])
      )
    }

    if (loads.length === 0) {
      setRows([])
      return
    }
    void Promise.all(loads).then((groups) => {
      if (alive) setRows(groups.flat())
    })
    return () => {
      alive = false
    }
  }, [neteaseAccount, qqAccount])

  return rows
}
