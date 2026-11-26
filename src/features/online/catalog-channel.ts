import type { ProviderId } from './types.ts'
import { askProvider, warnChannel } from './channel-core.ts'

/**
 * 专辑页与艺人页在渲染层的入口。
 *
 * 这一批只搬家、不改语义：失败仍折回 null / 空数组，与旧通道逐字段一致。
 * 「读失败被画成专辑不存在」是既有问题，页面各自有 catch、有各自的说法，
 * 要改得连页面一起改，留作单独一版。
 */

/** 一张专辑（曲目在里面）。 */
export async function providerAlbum<T>(provider: ProviderId, albumId: number): Promise<T | null> {
  const answer = await askProvider<T | null>(provider, 'album', { albumId })
  if (answer.ok) return answer.value ?? null
  warnChannel(provider, 'album', answer.why)
  return null
}

/** 艺人的简介、头像、作品数。 */
export async function providerArtist<T>(provider: ProviderId, artistId: number): Promise<T | null> {
  const answer = await askProvider<T | null>(provider, 'artistDetail', { artistId })
  if (answer.ok) return answer.value ?? null
  warnChannel(provider, 'artistDetail', answer.why)
  return null
}

/** 艺人的热门曲目。 */
export async function providerArtistTopSongs<T>(
  provider: ProviderId,
  artistId: number,
  limit?: number
): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'artistTopSongs', { artistId, limit })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'artistTopSongs', answer.why)
  return []
}

/** 艺人页「全部歌曲」的一页。 */
export async function providerArtistSongs<T>(
  provider: ProviderId,
  artistId: number,
  limit?: number,
  offset?: number
): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'artistSongs', { artistId, limit, offset })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'artistSongs', answer.why)
  return []
}

/**
 * 平台的新碟榜。
 *
 * 与上面几支不同的是：它不是用户数据，也不属于任何一页的详情——首页那排
 * 推荐专辑要的是「平台在推什么」。目前只有网易云真有这张榜，另外两家是从
 * 新歌榜里抽专辑（走 newSongs 通道，各自在渲染层拼）。
 *
 * limit 是本次要几张，缺了按主进程的 24。
 */
export async function providerNewAlbums<T>(
  provider: ProviderId,
  limit?: number,
  offset?: number
): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'newAlbums', { limit, offset })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'newAlbums', answer.why)
  return []
}

/** 艺人页「专辑」的一页。 */
export async function providerArtistAlbums<T>(
  provider: ProviderId,
  artistId: number,
  limit?: number,
  offset?: number
): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'artistAlbums', { artistId, limit, offset })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'artistAlbums', answer.why)
  return []
}

/** 按 id 取一首（汽水的 alias 单曲接口）。取不到返回 null。 */
export async function providerSongById<T>(provider: ProviderId, songId: number): Promise<T | null> {
  const answer = await askProvider<T | null>(provider, 'song', { songId })
  if (answer.ok) return answer.value ?? null
  warnChannel(provider, 'song', answer.why)
  return null
}

/** 按 id 取若干首歌的完整记录（列表里没有的歌要靠它补）。 */
export async function providerSongDetail<T>(provider: ProviderId, ids: number[]): Promise<T[]> {
  const answer = await askProvider<T[]>(provider, 'songDetail', { ids })
  if (answer.ok) return Array.isArray(answer.value) ? answer.value : []
  warnChannel(provider, 'songDetail', answer.why)
  return []
}

