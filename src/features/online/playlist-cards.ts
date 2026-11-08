import { useEffect, useMemo } from 'react'
import { useOnlineStore } from './store'
import type { OnlinePlaylistSummary, PlaylistOwnership, ProviderId } from './types'

/**
 * 歌单卡片：所有「摆出一张歌单」的地方共用同一个形状。
 *
 * 以前有两套：`shelves.ts` 的 `ShelfCard`（各平台全量混排，给收藏页用）和
 * `recommended.ts` 自己拼的同一份东西（给推荐位用）。两边字段一样、来源不一样，
 * 于是「收藏的歌单」和「平台推荐的歌单」在界面上长得一样，谁也说不清这一格到底
 * 是我收的还是它推的。现在合成一个形状，归属写在卡片上。
 *
 * 数据只有一条来源：平台 store 的 `myPlaylists`。谁要什么，用下面的分组函数
 * 自己筛，不再各写一份取数逻辑。
 */
export interface PlaylistCard {
  key: string
  providerId: ProviderId
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  creator: string
  /** 谁拥有它。推荐位的卡片是 `'unknown'`：平台推的，不是谁的。 */
  ownership: PlaylistOwnership
}

export const PLAYLIST_PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'netease', label: '网易云音乐' },
  { id: 'qq', label: 'QQ 音乐' },
  { id: 'kugou', label: '酷狗音乐' },
  { id: 'qishui', label: '汽水音乐' }
]

/**
 * 归属判定。
 *
 * 平台给了 `ownership` 就用它；没给的（网易云这条链一路是主进程原样返回的），
 * 退回它的原生 `subscribed`。两者都没有时答 `'unknown'`，不猜。
 */
export function ownershipOf(
  summary: Pick<OnlinePlaylistSummary, 'subscribed' | 'ownership'> | null | undefined
): PlaylistOwnership {
  if (!summary) return 'unknown'
  if (summary.ownership) return summary.ownership
  if (typeof summary.subscribed === 'boolean') return summary.subscribed ? 'collected' : 'mine'
  return 'unknown'
}

export function toCard(
  provider: { id: ProviderId; label: string },
  playlist: OnlinePlaylistSummary
): PlaylistCard {
  return {
    key: provider.id + ':' + playlist.id,
    providerId: provider.id,
    providerLabel: provider.label,
    id: playlist.id,
    name: playlist.name,
    coverUrl: playlist.coverUrl,
    trackCount: playlist.trackCount,
    creator: playlist.creator,
    ownership: ownershipOf(playlist)
  }
}

/**
 * 四个平台账号里的歌单，摊成一张表。
 *
 * 调用次数写死成四：hooks 不能在循环里，而平台表本来就是常量。多一个平台只改
 * 这里的调用行，漏掉一处 tsc 会提醒。
 */
export function useAccountPlaylists(): PlaylistCard[] {
  const netease = useOnlineStore('netease')()
  const qq = useOnlineStore('qq')()
  const kugou = useOnlineStore('kugou')()
  const qishui = useOnlineStore('qishui')()

  useEffect(() => {
    // 未接入或未登录的平台会回一个空壳，init 只是让它自己报「连不上」，不会抛。
    for (const platform of PLAYLIST_PROVIDERS) {
      void useOnlineStore(platform.id).getState().init().catch(() => {})
    }
  }, [])

  return useMemo(() => {
    const rows: PlaylistCard[] = []
    rows.push(...netease.playlists.map((row) => toCard(PLAYLIST_PROVIDERS[0], row)))
    rows.push(...qq.playlists.map((row) => toCard(PLAYLIST_PROVIDERS[1], row)))
    rows.push(...kugou.playlists.map((row) => toCard(PLAYLIST_PROVIDERS[2], row)))
    rows.push(...qishui.playlists.map((row) => toCard(PLAYLIST_PROVIDERS[3], row)))
    return rows
  }, [netease.playlists, qq.playlists, kugou.playlists, qishui.playlists])
}

/** 我收藏的：明确是收来的，加上平台分不出来但至少不是「我建的」。 */
export function collectedOnly(rows: readonly PlaylistCard[]): PlaylistCard[] {
  return rows.filter((row) => row.ownership !== 'mine')
}

/** 我建的：只有平台明确说是自己建的那些。 */
export function mineOnly(rows: readonly PlaylistCard[]): PlaylistCard[] {
  return rows.filter((row) => row.ownership === 'mine')
}
