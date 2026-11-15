import type { Track } from '../../types'

/**
 * 「喜欢」的两个来源，以及不变量很少的那几条规则。
 *
 * 本地文件进本机收藏（zustand + 磁盘），在线歌进平台账号（网络写入）。
 * 这里只放能直接测的纯函数：判断一首歌归谁管，以及乐观更新时怎么合并列表。
 */

/** 一首歌的喜欢归哪个来源：`local`，或平台的 provider id。 */
export type LikeSource = 'local' | string

export function likeSourceOf(track: Track | null | undefined): LikeSource {
  const source = track?.source
  // 缺省就是本地，和 Track.source 的约定一致。
  return source && source !== 'local' ? source : 'local'
}

/**
 * 把一次喜欢/取消喜欢合并进已喜欢列表。
 *
 * 乐观更新的那条路径，所以它必须只做一件事：已喜欢时把这首歌放到最前（最近
 * 挑的应该最先看到），取消时只摘掉它。先去重再插入，是因为同一首歌可能在列表
 * 里出现两次（刚拉回来的列表 + 用户刚点的这一条），重复的 key 会让 React 报错。
 */
export function applyLiked(rows: Track[], track: Track, liked: boolean): Track[] {
  const without = rows.filter((row) => row.id !== track.id)
  return liked ? [track, ...without] : without
}

/**
 * 按「点红心的时刻」从新到旧。
 *
 * 喜欢页要把本地收藏和四家平台的红心拼成一条时间线：本地那份自带 `at`，平台
 * 那份靠 `useLikes.stamps` 记我们点过的时刻（平台接口不按时间给）。没有时间的
 * 历史收藏是 0，排在最后，彼此保持接口原来的顺序——`sort` 在 ES2019 起是稳定
 * 的，所以只比 `at` 就够。
 */
export function newestFirst<T extends { at: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => right.at - left.at)
}
