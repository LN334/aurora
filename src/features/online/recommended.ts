import { useEffect, useMemo } from 'react'
import { useDiscover } from '../discover/store'
import type { ShelfCard } from './shelves'
import { shuffleWithSeed } from './shuffle'
import { useOnlineStore } from './store'

/**
 * 首页「歌单」这一栏的数据。
 *
 * 这里要的是「平台推荐了什么」，不是「我收藏了什么」——两边是两码事，之前
 * 拿 `useShelves`（各平台的我的歌单）来填，于是首屏出现了自己的「我喜欢的
 * 音乐」和自建歌单，看起来像把音乐库搬到了推荐位。
 *
 * 现在只收公开推荐：网易云的推荐歌单走发现接口；酷狗未登录时给的公开榜单
 * 本身就是推荐位。QQ 与汽水的公开歌单列表要账号、也没有独立的推荐接口，
 * 所以它们不出现在这里 —— 它们的内容在搜索、收藏、我的喜欢里。
 */
export function useRecommendedPlaylists(): ShelfCard[] {
  const block = useDiscover((state) => state.blocks.playlists)
  const kugou = useOnlineStore('kugou')()

  useEffect(() => {
    void useDiscover.getState().load('playlists').catch(() => {})
    void useOnlineStore('kugou').getState().init().catch(() => {})
  }, [])

  return useMemo(() => {
    const rows: ShelfCard[] = block.playlists.map((playlist) => ({
      key: 'netease:' + playlist.id,
      providerId: 'netease' as const,
      providerLabel: '网易云音乐',
      id: playlist.id,
      name: playlist.name,
      coverUrl: playlist.coverUrl,
      trackCount: playlist.trackCount,
      creator: playlist.creator
    }))
    for (const playlist of kugou.playlists) {
      rows.push({
        key: 'kugou:' + playlist.id,
        providerId: 'kugou',
        providerLabel: '酷狗音乐',
        id: playlist.id,
        name: playlist.name,
        coverUrl: playlist.coverUrl,
        trackCount: playlist.trackCount,
        creator: playlist.creator
      })
    }
    return rows
  }, [block.playlists, kugou.playlists])
}

/**
 * 一批歌单：每个平台各出几张。
 *
 * 不是把两家的单子倒在一起洗 —— 池子大的那家会占满整行（酷狗 35 张、网易云
 * 24 张），看起来像只接了酷狗。按平台限定之后，每行都是「各家各几张」。
 * 平台内部仍然是随机的，「换一批」换的就是这一层。
 */
export function picksByProvider(
  rows: readonly ShelfCard[],
  batch: number,
  perProvider: number
): { picks: ShelfCard[]; rest: ShelfCard[] } {
  const groups = new Map<string, ShelfCard[]>()
  for (const row of rows) {
    const bucket = groups.get(row.providerId)
    if (bucket) bucket.push(row)
    else groups.set(row.providerId, [row])
  }

  const shuffled = Array.from(groups.values()).map((bucket) => shuffleWithSeed(bucket, batch))
  const picks: ShelfCard[] = []
  const rest: ShelfCard[] = []
  // 交错取：第 1 张来自网易云、第 2 张来自酷狗…… 而不是前几张全同一家。
  for (let index = 0; index < perProvider; index += 1) {
    for (const bucket of shuffled) {
      const row = bucket[index]
      if (row) picks.push(row)
    }
  }
  for (const bucket of shuffled) {
    rest.push(...bucket.slice(perProvider, perProvider * 2))
  }
  return { picks, rest }
}