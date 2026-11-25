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
/**
 * A moment as "how long ago": `刚刚`, `5 分钟前`, `3 小时前`, `2 天前`.
 *
 * Relative rather than absolute wherever the value is about recency: "昨天
 * 22:41" makes the reader do the subtraction, and a comment wall is scanned,
 * not read. Past a month the exact date is more useful than "89 天前".
 */
export function formatSince(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const diff = Date.now() - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前'
  if (diff < 30 * 86_400_000) return Math.floor(diff / 86_400_000) + ' 天前'
  return new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** 一段时长的最小单元：数字与单位分开，好让统计卡把数字放大、单位压小。 */
type SpanPart = { n: number; u: string }

export function spanParts(seconds: number): SpanPart[] {
  if (!Number.isFinite(seconds) || seconds < 1) return [{ n: 0, u: '秒' }]
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? [{ n: h, u: '小时' }, { n: m, u: '分' }] : [{ n: h, u: '小时' }]
  if (m >= 10) return [{ n: m, u: '分钟' }]
  if (m > 0) return s > 0 ? [{ n: m, u: '分' }, { n: s, u: '秒' }] : [{ n: m, u: '分钟' }]
  return [{ n: s, u: '秒' }]
}

export function formatSpan(seconds: number): string {
  return spanParts(seconds)
    .map((part) => `${part.n} ${part.u}`)
    .join(' ')
}
