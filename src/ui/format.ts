/**
 * Seconds to a clock string: `3:07`, or `1:02:03` once there is an hour.
 *
 * Lives in `ui/` rather than next to the progress bar because the track list, the
 * queue and the playlist screen all need it. Keeping it on the player component
 * made those views reach into `features/` for a string formatter, which is
 * backwards: a primitive should not depend on a feature.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * A duration in words: `45 秒`, `5 分 45 秒`, `16 分钟`, `2 小时 13 分`.
 *
 * Must stay separate from formatTime: that one is a clock position (`3:07`),
 * and reusing it for the total listening time of a collection reads as
 * "five forty-five" instead of "five minutes forty-five". Anything that sums
 * several tracks goes through here.
 */
export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return '0 秒'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
  if (m >= 10) return `${m} 分钟`
  if (m > 0) return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`
  return `${s} 秒`
}
