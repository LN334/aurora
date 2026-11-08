import { useEffect, useMemo, useState } from 'react'
import { useDiscover } from '../discover/store'
import { useRoamPlatforms } from '../player/roam-sources'
import type { PlaylistCard } from './playlist-cards'
import { shuffleWithSeed } from './shuffle'
import { useOnlineStore } from './store'

/**
 * 首页「歌单」这一栏的数据。
 *
 * 这里要的是「平台推荐了什么」，不是「我收藏了什么」——两边是两码事，之前
 * 拿账号歌单来填，于是首屏出现了自己的歌单，看起来像把音乐库搬到了推荐位。
 *
 * 现在只收公开推荐：网易云的推荐歌单走发现接口；酷狗未登录时给的公开榜单
 * 本身就是推荐位；QQ 用标签歌单接口（不需要账号）；汽水用公开歌单搜索的热词。
 * 四家各给几张，一条推荐位上四家的东西都能看到。
 *
 * 推荐位的卡片没有归属（`ownership: 'unknown'`）：那是平台推的，不是谁的。
 */
/**
 * 汽水这一侧的「推荐」：公开歌单搜索，不需要账号。
 *
 * 关键词必须落在「歌单」的语境里。用「热歌」这种词搜回来的是
 * 「2026抖音热歌排行榜」「车载DJ抖音热歌」这类榜单式条目，名字本身就在说
 * 它不是歌单；换成「歌单 / 民谣 / 华语 / 夜晚」之后回来的才是别人整理的单子
 * （「全球热门音乐歌单」「民谣合集｜适合一个人慢慢聆听」）。
 * 三个词各取几张再合并，免得一整排都是同一个主题。
 */
const QISHUI_WORDS = ['歌单', '民谣', '夜晚']

export function useRecommendedPlaylists(): PlaylistCard[] {
  const block = useDiscover((state) => state.blocks.playlists)
  const kugou = useOnlineStore('kugou')()
  const [qishui, setQishui] = useState<PlaylistCard[]>([])
  const [qq, setQq] = useState<PlaylistCard[]>([])
  /*
   * 「推荐来源」那一页的勾选必须管到这里。
   *
   * 以前它只管漫游和每日推荐，首页这一排照样四家都上——用户在设置里关掉
   * QQ、酷狗、汽水之后回到首页，看到的还是那三家，等于那个开关是假的。
   */
  const chosen = useRoamPlatforms()
  const chosenKey = chosen.join(',')

  // 取数只在进页面时做一次；勾选变化只影响下面两个 effect 与最后的过滤。
  useEffect(() => {
    void useDiscover.getState().load('playlists').catch(() => {})
    void useOnlineStore('kugou').getState().init().catch(() => {})
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!chosen.includes('qishui')) {
        setQishui([])
        return
      }
      const api = window.aurora?.qishui
      if (!api?.searchPlaylists) return
      const batches = await Promise.all(
        QISHUI_WORDS.map((word) => api.searchPlaylists(word, 6).catch(() => []))
      )
      const seen = new Set<number>()
      const rows = batches.flat().filter((row) => {
        if (seen.has(row.id)) return false
        seen.add(row.id)
        return true
      })
      if (!alive || rows.length === 0) return
      setQishui(
        rows.map((row) => ({
          key: 'qishui:' + row.id,
          providerId: 'qishui' as const,
          providerLabel: '汽水音乐',
          id: row.id,
          name: row.name,
          coverUrl: row.coverUrl,
          trackCount: row.trackCount,
          creator: row.creator,
          ownership: 'unknown' as const
        }))
      )
    })()
    return () => {
      alive = false
    }
  }, [chosenKey])

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!chosen.includes('qq')) {
        setQq([])
        return
      }
      const api = window.aurora?.qq
      if (!api?.recommendPlaylists) return
      const rows = await api.recommendPlaylists(12).catch(() => [])
      if (!alive || rows.length === 0) return
      setQq(
        rows.map((row) => ({
          key: 'qq:' + row.id,
          providerId: 'qq' as const,
          providerLabel: 'QQ 音乐',
          id: row.id,
          name: row.name,
          coverUrl: row.coverUrl,
          trackCount: row.trackCount,
          creator: row.creator,
          ownership: 'unknown' as const
        }))
      )
    })()
    return () => {
      alive = false
    }
  }, [chosenKey])

  return useMemo(() => {
    const rows: PlaylistCard[] = block.playlists.map((playlist) => ({
      key: 'netease:' + playlist.id,
      providerId: 'netease' as const,
      providerLabel: '网易云音乐',
      id: playlist.id,
      name: playlist.name,
      coverUrl: playlist.coverUrl,
      trackCount: playlist.trackCount,
      creator: playlist.creator,
      ownership: 'unknown' as const
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
        creator: playlist.creator,
        ownership: 'unknown'
      })
    }
    rows.push(...qq)
    rows.push(...qishui)
    // 最后再按勾选筛一遍：网易云与酷狗的行是上面拼进来的，没经过 effect。
    return rows.filter((row) => chosen.includes(row.providerId as never))
  }, [block.playlists, kugou.playlists, qq, qishui, chosenKey])
}

/**
 * 一批歌单：每个平台各出几张。
 *
 * 不是把两家的单子倒在一起洗 —— 池子大的那家会占满整行（酷狗 35 张、网易云
 * 24 张），看起来像只接了酷狗。按平台限定之后，每行都是「各家各几张」。
 * 平台内部仍然是随机的，「换一批」换的就是这一层。
 */
export function picksByProvider(
  rows: readonly PlaylistCard[],
  batch: number,
  perProvider: number
): { picks: PlaylistCard[]; rest: PlaylistCard[] } {
  const groups = new Map<string, PlaylistCard[]>()
  for (const row of rows) {
    const bucket = groups.get(row.providerId)
    if (bucket) bucket.push(row)
    else groups.set(row.providerId, [row])
  }

  const shuffled = Array.from(groups.values()).map((bucket) => shuffleWithSeed(bucket, batch))
  const picks: PlaylistCard[] = []
  const rest: PlaylistCard[] = []
  // 交错取：第 1 张来自网易云、第 2 张来自酷狗…… 而不是前几张全同一家。
  for (let index = 0; index < perProvider; index += 1) {
    for (const bucket of shuffled) {
      const row = bucket[index]
      if (row) picks.push(row)
    }
  }
  /*
   * 网格是六列，最后一行不能缺口：多出来的那一两张留到「更多歌单」去。
   * 平台的可用张数不齐（某一家只有 10 张），不裁就会在末尾留一排空格。
   */
  const COLUMNS = 6
  const overflow = picks.length % COLUMNS
  if (overflow > 0) rest.push(...picks.splice(picks.length - overflow, overflow))

  for (const bucket of shuffled) {
    rest.push(...bucket.slice(perProvider, perProvider * 2))
  }
  return { picks, rest }
}
