/**
 * 一起听的进度算术：纯函数，不碰播放器也不碰网络。
 *
 * 房间里同步的「现在」是一条带时间戳的位置——房主发出时播到第几秒、那一刻
 * 是几点。客人收到时不照抄那个秒数，而是按自己与房主的时间差补上：一条消息
 * 在网络里走几百毫秒，照抄就慢几百毫秒，几趟下来能差出小半首。
 *
 * 这里只有三条判断：该不该拖位置、该不该跟着起停、以及客人刚自己拖过时先
 * 别动。判定都写成函数，是因为它们能被 `node --test` 直接跑——对照真实的
 * 两个播放器要靠开着两个窗口手点，太贵，也说不清边界。
 */

/** 房主发出来的那一刻。`PartyNow` 原样传进来就行。 */
export interface PartyMoment {
  /** Unix 毫秒：这条消息是什么时候发出的。 */
  at: number
  /** 那一刻播到第几秒。 */
  position: number
  playing: boolean
}

/** 这台机器上的播放状态。 */
export interface LocalPlayback {
  position: number
  playing: boolean
}

/**
 * 偏差超过这个秒数才纠正。
 *
 * 小于它时人耳听不出不同步，硬拉一下反而像卡带；也留给两边各自的缓冲一点
 * 余地。房主每 4 秒报一次位置，所以客人最多差这么多，不会再越拖越远。
 */
export const DRIFT_LIMIT = 3

/**
 * 客人自己拖完进度之后，这段时间里不去把他拉回房主那儿。
 *
 * 比一次推送间隔长，否则刚拖完就收到下一条、位置立刻被打回去——用户看到的
 * 正是「拖了没用」。窗口过后还是会回去：一起听里房主才是准的那个。
 */
export const HOLD_MS = 8000

/** 房主那一刻的位置，按到现在的流逝补到当前。 */
export function expectedPosition(moment: PartyMoment, at: number): number {
  const waited = (at - moment.at) / 1000
  if (!Number.isFinite(waited) || waited <= 0) return moment.position
  return moment.position + (moment.playing ? waited : 0)
}

/**
 * 该拖到第几秒；null 表示不用动。
 *
 * `holding` 为真时一律不动：那是客人自己拖过、还没出抑制窗口的情形。
 */
export function seekTarget(
  moment: PartyMoment,
  local: LocalPlayback,
  at: number,
  holding = false
): number | null {
  if (holding) return null
  const target = expectedPosition(moment, at)
  if (!Number.isFinite(target)) return null
  return Math.abs(local.position - target) > DRIFT_LIMIT ? target : null
}

/** 该切到「在放」还是「暂停」；null 表示本来就一致。 */
export function playStateFor(moment: PartyMoment, local: LocalPlayback): boolean | null {
  return moment.playing === local.playing ? null : moment.playing
}

/** 播放时钟的一次采样。 */
export interface PlaybackTick {
  /** 当前曲目 id。换歌不算拖进度。 */
  trackId: string
  position: number
  playing: boolean
  /** 采样的 Unix 毫秒。 */
  at: number
}

/**
 * 跳多少秒才算「有人拖了进度」。
 *
 * 两次采样之间最多隔几十毫秒（引擎按帧或 250ms 报位置），正常播放走不了这么远。
 */
const SEEK_JUMP = 2

/**
 * 这两次采样之间，是不是这台机器上的人自己拖了进度。
 *
 * 房主切歌带过来的位置变化不算：那条路会换 `trackId`，位置归零是跟着房间走
 * 的，不是本地拖动。只有同一首歌里位置突然跑掉一大截才算。
 */
export function sawSeek(before: PlaybackTick, after: PlaybackTick): boolean {
  if (before.trackId !== after.trackId) return false
  const elapsed = Math.max(0, (after.at - before.at) / 1000)
  const expected = before.position + (before.playing ? elapsed : 0)
  return Math.abs(after.position - expected) > SEEK_JUMP
}
