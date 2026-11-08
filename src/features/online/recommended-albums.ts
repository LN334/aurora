import { useEffect, useState } from 'react'

/**
 * 首页「推荐专辑」。
 *
 * 推荐位要的是「平台在推什么」，所以取云音乐新碟（top_album）——这条不需要
 * 账号。其他平台的新碟接口还没接，先只出这一家；接一家总比拿我的收藏充数好。
 */
export interface AlbumCard {
  key: string
  providerId: 'netease'
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  artistName: string
  year: number
}

export function useRecommendedAlbums(limit = 18): AlbumCard[] {
  const [rows, setRows] = useState<AlbumCard[]>([])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const api = window.aurora?.netease
        if (!api?.topAlbums) return
        const list = await api.topAlbums(limit)
        if (!alive) return
        setRows(
          (list ?? [])
            .filter((row) => row.id > 0 && row.name)
            .map((row) => ({
              key: 'netease:' + row.id,
              providerId: 'netease' as const,
              providerLabel: '网易云音乐',
              id: row.id,
              name: row.name,
              coverUrl: row.coverUrl,
              artistName: row.artistName,
              year: row.year
            }))
        )
      } catch {
        /* 拿不到就当没有这一栏，首页不该为一张封面停住 */
      }
    })()
    return () => {
      alive = false
    }
  }, [limit])

  return rows
}
