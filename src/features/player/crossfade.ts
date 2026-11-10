/**
 * 切歌时淡出／淡入各用多久（毫秒）。
 *
 * 这段算法单独拿出来，是为了让它能被测试钉住：上一版在引擎里读 `crossfadeSec`
 * 只把它当成一个开关（>0 就淡 190ms），滑到 12 秒和滑到 1 秒没有区别。设置里的
 * 数字要真起作用，就得从「是不是大于 0」变成「等于多少毫秒」。
 */

/** 滑块的上限。再长就不像切歌，像换台。 */
const MAX_SWAP_MS = 6000

export function swapFadeMs(crossfadeSec: number): number {
  if (!Number.isFinite(crossfadeSec) || crossfadeSec <= 0) return 0
  return Math.min(Math.round(crossfadeSec * 1000), MAX_SWAP_MS)
}
