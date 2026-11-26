import type { Track } from '../../types'

/**
 * 一次「各平台我喜欢的」读取里，一家的结果。
 *
 * `failed` 说的是「这次没问出来」，不是「这家一首都没收藏」。两者在数据上都是
 * 空数组，混为一谈就会把一次上游 502 显示成「你一首喜欢的歌都没有」——用户看到
 * 的正是首页那张卡上的「0 首」，而他收藏的六百多首一首没少。
 */
export interface LikedPart {
  tracks: Track[]
  failed: boolean
}

export interface LikedFold {
  tracks: Track[]
  /** 这一趟有几家没问出来。0 才是「真的读完了」。 */
  failed: number
}

/** 把各家结果并成一份，顺带数出这一趟有几家没问出来。 */
export function foldLikedParts(parts: LikedPart[]): LikedFold {
  const tracks: Track[] = []
  let failed = 0
  for (const part of parts) {
    if (part.failed) failed += 1
    for (const track of part.tracks) tracks.push(track)
  }
  return { tracks, failed }
}

/** 读成功的那一份能信十分钟：上游按账号限流，翻来翻去没必要每次都问。 */
export const LIKED_TTL = 10 * 60 * 1000

/**
 * 有平台没问出来时，这份缓存只活三十秒。
 *
 * 以前失败也按十分钟缓存，于是上游断了两秒，首页那个「0 首」要挂满十分钟——
 * 用户在这段时间里点进点出都看不到自己的收藏，只会以为收藏被清了。
 */
export const LIKED_FAIL_TTL = 30 * 1000

export function likedCacheTtl(failed: number, count: number): number {
  /*
   * 空结果也只信三十秒。
   *
   * 「一首都读不到」看起来像「他没有收藏」，但链路抖动时上游同样会答一个空
   * 身子而不报错，而冷启动那一次读取正撞在四家同时开火、最容易被打回空的时刻。
   * 十分钟缓存等于把这个假空锁死：用户点进点出都是「还没有喜欢的歌」，只有重启
   * 或者等缓存过期才恢复。三十秒足够压住翻来覆去地点，又不至于把一次抖动变成
   * 一个上午的错觉。
   */
  return failed > 0 || count === 0 ? LIKED_FAIL_TTL : LIKED_TTL
}

/** 一条都没有时，到底是「你没有」还是「没读到」。只有后者能怨上游。 */
export function likedReadFailed(count: number, failed: number): boolean {
  return count === 0 && failed > 0
}

/**
 * 首页那张卡上印的字。
 *
 * 还没读完印「—」，读完了印条数；唯独「一条没读到、又有平台没应答」不印
 * 「0 首」——那是在替上游宣布用户没有收藏。
 */
export function likedCountLabel(ready: boolean, count: number, failed: number): string {
  if (!ready) return '—'
  return likedReadFailed(count, failed) ? '未读到' : `${count} 首`
}
