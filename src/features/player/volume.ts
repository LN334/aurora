/**
 * 音量的两条边界规则。
 *
 * 桌面播放器的音量有两个状态：音量值本身，和「静音」开关。两者独立会出现一个
 * 说不通的状态：音量被拖到 0，再点静音键取消静音，界面显示「已经不静音了」，
 * 声音却仍然是 0 —— 用户会直接判断这个键坏了。所以恢复静音时，若音量低到听
 * 不见，就抬到一个能听见的值。
 *
 * 滚轮同理：一格只走一小步，而不是让一次 120 单位的 delta 直接把滑块甩到底。
 */

/** 低于这个音量在正常耳机/音箱上已经听不出区别。 */
export const MIN_AUDIBLE_VOLUME = 0.05

/** 从 0 恢复播放时用这个音量：不炸耳朵，也明显能听见。 */
export const RESTORE_VOLUME = 0.6

/** 滚轮一格改变多少。 */
export const WHEEL_STEP = 0.05

/** 取消静音时要用的音量：原本听得见就原样保留，听不见就回到默认值。 */
export function volumeForUnmute(volume: number): number {
  if (!Number.isFinite(volume)) return RESTORE_VOLUME
  return volume >= MIN_AUDIBLE_VOLUME ? Math.min(1, volume) : RESTORE_VOLUME
}

/** 滚轮：只取方向，每格 {@link WHEEL_STEP}，结果夹在 0..1。 */
export function wheelVolume(volume: number, direction: number): number {
  if (!Number.isFinite(volume) || !Number.isFinite(direction)) return volume
  const step = Math.sign(direction) * WHEEL_STEP
  return Math.min(1, Math.max(0, volume + step))
}
