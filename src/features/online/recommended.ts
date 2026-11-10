import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDiscover } from '../discover/store'
import { usePushPlatforms } from './push-platforms'
import type { PlaylistCard } from './playlist-cards'
import { shuffleWithSeed } from './shuffle'
import { fillSlots, groupRows, SLOTS } from './slots'
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

/**
 * 各家都落定之后再多等一会儿。
 *
 * 同一批卡片常分两次提交：store 里那一份先落，搜索回来那一份后落，中间隔着
 * 一两帧。放行晚一帧，两批就并成同一次画，不会看到一排卡先出现又补满。
 */
const READY_TAIL_MS = 120

/** 这一排要的东西，连同「可以画了没有」。 */
interface RecommendedPlaylists {
  rows: PlaylistCard[]
  /** 勾选的每一家都问过一遍了（成功失败都算）。 */
  ready: boolean
}

export function useRecommendedPlaylists(): RecommendedPlaylists {
  const block = useDiscover((state) => state.blocks.playlists)
  const kugou = useOnlineStore('kugou')()
  const [qishui, setQishui] = useState<PlaylistCard[]>([])
  const [qq, setQq] = useState<PlaylistCard[]>([])
  /*
   * 每一家落定就记一笔。
   *
   * 以前是边到边画：网易云的块先回来就先长六格，QQ 回来再长六格，首页这一排
   * 是一格一格冒出来的。占位格挡得住高度跳动，挡不住「东西在偷偷填」。所以
   * 这里只记落定、不记先后，由上层等齐了再一次性换成真卡。
   */
  const [done, setDone] = useState<Record<string, boolean>>({})
  const markDone = useCallback((id: string) => {
    setDone((prev) => (prev[id] ? prev : { ...prev, [id]: true }))
  }, [])
  /*
   * 「推荐来源」那一页的勾选必须管到这里。
   *
   * 以前它只管漫游和每日推荐，首页这一排照样四家都上——用户在设置里关掉
   * QQ、酷狗、汽水之后回到首页，看到的还是那三家，等于那个开关是假的。
   */
  /*
   * 与每日推荐同一个判断：勾着且登录着的平台才问（push-platforms）。还没问完时
   * 给 null，这一排就停在占位，别先画一版再收紧。
   */
  const chosen = usePushPlatforms()
  const list = chosen ?? []
  const chosenKey = list.join(',')

  // 取数只在进页面时做一次；勾选变化只影响下面两个 effect 与最后的过滤。
  useEffect(() => {
    void useDiscover
      .getState()
      .load('playlists')
      .catch(() => {})
  }, [])

  /*
   * 网易云：块状态离开 idle/loading 就算落定，成功失败都算。
   * 失败也放行是有意的——接口挂了要收起骨架，而不是让一排卡永远停在占位。
   */
  const neteaseDone = block.status === 'ready' || block.status === 'failed'
  useEffect(() => {
    if (neteaseDone) markDone('netease')
  }, [neteaseDone, markDone])

  /*
   * 酷狗：歌单是 init 里顺手发出去的（未登录走公开榜单），拿不到自己的 promise。
   * 所以用「init 完成 + 不在加载中」两条件近似落定，中间可能差的一帧由
   * READY_TAIL_MS 那个收敛窗吃掉。
   */
  const [kugouInit, setKugouInit] = useState(false)
  useEffect(() => {
    let alive = true
    void useOnlineStore('kugou')
      .getState()
      .init()
      .catch(() => {})
      .finally(() => {
        if (alive) setKugouInit(true)
      })
    return () => {
      alive = false
    }
  }, [])
  const kugouLoading = kugou.playlistsLoading
  useEffect(() => {
    if (kugouInit && !kugouLoading) markDone('kugou')
  }, [kugouInit, kugouLoading, markDone])

  useEffect(() => {
    let alive = true
    void (async () => {
      // 关掉的那家也算落定：它连请求都不发，等它只会让这一排永远停在占位。
      try {
        if (!chosen) return
        if (!list.includes('qishui')) {
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
      } finally {
        if (alive) markDone('qishui')
      }
    })()
    return () => {
      alive = false
    }
  }, [chosenKey, markDone])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (!chosen) return
        if (!list.includes('qq')) {
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
      } finally {
        if (alive) markDone('qq')
      }
    })()
    return () => {
      alive = false
    }
  }, [chosenKey, markDone])

  const rows = useMemo(() => {
    const out: PlaylistCard[] = block.playlists.map((playlist) => ({
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
      out.push({
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
    out.push(...qq)
    out.push(...qishui)
    // 最后再按勾选筛一遍：网易云与酷狗的行是上面拼进来的，没经过 effect。
    return out.filter((row) => list.includes(row.providerId as never))
  }, [block.playlists, kugou.playlists, qq, qishui, chosenKey])

  /*
   * 要等哪几家，是按勾选算的。关掉的那家连请求都没发，把它算进来就永远等不到。
   */
  const wanted = useMemo(
    () => ['netease', 'kugou', 'qq', 'qishui'].filter((id) => list.includes(id as never)),
    // chosen 每份快照都是新数组，用 join 后的字符串当依赖。
    [chosenKey]
  )
  const allDone = wanted.every((id) => done[id])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!allDone) return
    const timer = window.setTimeout(() => setReady(true), READY_TAIL_MS)
    return () => window.clearTimeout(timer)
  }, [allDone])

  // 还没定下问哪几家时不要放行：放了就是先画一版空推荐再换掉。
  return { rows, ready: chosen === null ? false : ready }
}

/**
 * 一批歌单：把槽位填满，而不是每家固定几张。
 *
 * 原先按「每家 perProvider 张」取，总数 = 张数 × 勾选平台数——四家全开是 24 张，
 * 勾掉一家就只剩 18 张，首页那一排会短一截。现在槽位是常量（SLOTS.playlist），
 * 各家的桶轮转着往里填：一家一家出，先耗尽的先退出，剩下的位置由别家补上。
 *
 * 平台构成仍然要混着，「换一批」在各家内部换；槽位应是网格列数的整数倍，
 * 否则最后一行会缺口。
 */
export function picksByProvider(
  rows: readonly PlaylistCard[],
  batch: number,
  slots = SLOTS.playlist
): { picks: PlaylistCard[]; rest: PlaylistCard[] } {
  const groups = groupRows(rows, (row) => row.providerId)
  const shuffled = [...groups.values()].map((bucket) => shuffleWithSeed(bucket, batch))
  const picked = fillSlots(shuffled, slots)
  /*
   * 交错取保证了一行里各家都有，代价却是位置和平台绑死：第 1 格永远网易云、
   * 第 2 格永远 QQ、第 3 格永远酷狗——扫一眼就知道格子等于平台，而这正是合并
   * 要消掉的东西。整批再洗一次：平台构成不变，位置不再可预测。
   */
  const picks = shuffleWithSeed(picked, batch * 7919 + 13)
  const used = new Set(picks.map((row) => row.key))
  return { picks, rest: rows.filter((row) => !used.has(row.key)) }
}
