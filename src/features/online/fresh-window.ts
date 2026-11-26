import type { Track } from '../../types'

/**
 * 几家平台的新歌并成一条长队，各家轮流坐庄。
 *
 * 直接按音源优先级排会变成「网易云前四十首」，另外两家永远进不了首屏——那和
 * 只接一家看起来没有区别。所以按来源分桶，第一轮每桶取第一首、第二轮取第二首，
 * 到某个桶见底就跳过去，轮满 rounds 轮或全空为止。
 *
 * 分桶键取 track.source，缺省算本机。同一个来源内的先后顺序不变，所以同一份
 * 输入两次调用给出同一条队：这一栏「换一批」靠窗口平移，不靠重排。
 */
export function interleaveBySource(tracks: readonly Track[], rounds = 60): Track[] {
  const buckets = new Map<string, Track[]>()
  for (const track of tracks) {
    const key = track.source ?? 'local'
    const bucket = buckets.get(key)
    if (bucket) bucket.push(track)
    else buckets.set(key, [track])
  }

  const out: Track[] = []
  for (let at = 0; at < rounds; at += 1) {
    let added = false
    for (const bucket of buckets.values()) {
      const next = bucket[at]
      if (next) {
        out.push(next)
        added = true
      }
    }
    if (!added) break
  }
  return out
}

/**
 * 从一条长队里取一屏，取到底就绕回开头。
 *
 * batch 每按一次「换一批」加一，窗口整屏往后挪；挪过尾巴之后从头补足，所以
 * 屏幕上永远是一整屏。队比一屏短时原样给出——那不是分页问题，是货就这么少。
 */
export function ringSlice<T>(rows: readonly T[], size: number, batch: number): T[] {
  if (rows.length <= size) return rows.slice()
  const start = (((batch * size) % rows.length) + rows.length) % rows.length
  const out = rows.slice(start, start + size)
  if (out.length < size) out.push(...rows.slice(0, size - out.length))
  return out
}
