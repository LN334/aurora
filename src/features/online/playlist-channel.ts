import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 歌单（读）在渲染层的统一入口。
 *
 * 四家对「我的歌单」只有一处真正的分歧：QQ 与汽水能顺手答出某张歌单是不是自己
 * 建的，网易云与酷狗不能。那条信息在各自的 provider 里补，这里只负责把同一件
 * 事按同一个名字问出去。
 *
 * 空货架与失败在这一层仍然分开：失败写 console.warn，返回值照旧是空数组——
 * 与搜索、账号两组保持同一条规矩，界面不必为「读不到」编一个错误画面。
 */

/** 账号里的歌单一览。上限交给主进程夹，这里只透传意图。 */
export async function providerMyPlaylists<T>(provider: ProviderId, limit?: number): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'myPlaylists', { limit })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'myPlaylists', answer.why)
  return []
}

/** 一张歌单里的歌。 */
export async function providerPlaylistTracks<T>(
  provider: ProviderId,
  playlistId: number | string
): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'playlistTracks', { playlistId })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'playlistTracks', answer.why)
  return []
}

/** 歌单作者。列表里不带，打开详情时补问一次。 */
export async function providerPlaylistCreator(
  provider: ProviderId,
  playlistId: number | string
): Promise<string> {
  const answer = await askProvider<string>(provider, 'playlistCreator', { playlistId })
  if (answer.ok) return typeof answer.value === 'string' ? answer.value : ''
  warnChannel(provider, 'playlistCreator', answer.why)
  return ''
}

/*
 * 公开推荐歌单（QQ 走标签歌单接口，酷狗走公开榜单）。
 *
 * 注意它跟 `myPlaylists` 是两件事：后者是账号自己的歌单，登录后里面会有
 * 「我喜欢」「默认收藏」这些；拿它去填首页推荐位，等于把用户收藏摆回推荐位。
 */
export async function providerRecommendPlaylists<T>(
  provider: ProviderId,
  limit?: number
): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'recommendPlaylists', { limit })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'recommendPlaylists', answer.why)
  return []
}

/**
 * 「这张歌单是不是我建的」。
 *
 * QQ 答的是一张数组（自建清单的另一条命令），汽水答的是逐张的布尔；两种形状
 * 都保留，兜底值由调用方给：只有它知道分不出来时该说空数组还是 null。
 */
export async function providerPlaylistOwned<T>(
  provider: ProviderId,
  playlistId: number | string | null,
  empty: T
): Promise<T> {
  const answer = await askProvider<T>(provider, 'playlistOwned', { playlistId })
  if (answer.ok) return answer.value
  warnChannel(provider, 'playlistOwned', answer.why)
  return empty
}

/** 按关键词搜公开歌单（汽水有，别家没有）。 */
export async function providerSearchPlaylists<T>(
  provider: ProviderId,
  keywords: string,
  limit?: number
): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'searchPlaylists', { keywords, limit })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'searchPlaylists', answer.why)
  return []
}

/*
 * 写侧：建单、加减歌、改名、删单。
 *
 * 与读侧同一条规矩——不抛，失败回 false/null。区别在于这些改动会落到平台账号
 * 上：拿到 false 就是真的没改成，界面照实说，不假装成功再让用户刷新时发现。
 *
 * 只有自己建的歌单写得动（收藏来的别人的单上游也会拒），所以调用方要先看
 * `OnlinePlaylistSummary.subscribed`，把编辑入口只给自建单。
 */
export async function providerPlaylistCreate<T>(
  provider: ProviderId,
  name: string
): Promise<T | null> {
  const answer = await askProvider<T>(provider, 'playlistCreate', { name })
  if (answer.ok) return answer.value ?? null
  warnChannel(provider, 'playlistCreate', answer.why)
  return null
}

export async function providerPlaylistAddTracks(
  provider: ProviderId,
  playlistId: number,
  songIds: number[]
): Promise<boolean> {
  const answer = await askProvider<boolean>(provider, 'playlistAddTracks', { playlistId, songIds })
  if (answer.ok) return answer.value === true
  warnChannel(provider, 'playlistAddTracks', answer.why)
  return false
}

export async function providerPlaylistRemoveTracks(
  provider: ProviderId,
  playlistId: number,
  songIds: number[]
): Promise<boolean> {
  const answer = await askProvider<boolean>(provider, 'playlistRemoveTracks', { playlistId, songIds })
  if (answer.ok) return answer.value === true
  warnChannel(provider, 'playlistRemoveTracks', answer.why)
  return false
}

export async function providerPlaylistRename(
  provider: ProviderId,
  playlistId: number,
  name: string
): Promise<boolean> {
  const answer = await askProvider<boolean>(provider, 'playlistRename', { playlistId, name })
  if (answer.ok) return answer.value === true
  warnChannel(provider, 'playlistRename', answer.why)
  return false
}

export async function providerPlaylistRemove(
  provider: ProviderId,
  playlistId: number
): Promise<boolean> {
  const answer = await askProvider<boolean>(provider, 'playlistDelete', { playlistId })
  if (answer.ok) return answer.value === true
  warnChannel(provider, 'playlistDelete', answer.why)
  return false
}
