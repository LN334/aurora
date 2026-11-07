import { sourceFor } from '../library/source'
import { sourceOrder } from '../settings/source-order'
import { loadOnlineStream } from './online-fetch'
import type { Track } from '../../types'

/**
 * 一首歌到底从哪个平台播。
 *
 * 多平台统一之后，一行可能挂着好几个版本。播放时按用户在设置里排的音源顺序
 * 依次试：本机文件先（不联网、不要会员），然后是偏好的平台。第一个拿得到流的
 * 就用，其余不动——所以「都有」不再是选择题，而是按设定的规则自动选。
 *
 * 缓存命中时是同步的；未命中就向平台要一次。全都不行才返回 null，让播放器
 * 如实报「这一首现在放不了」。
 */

function rank(source: string | undefined, order: readonly string[]): number {
  const index = order.indexOf(source ?? 'local')
  return index === -1 ? order.length : index
}

/** 候选版本：主行自己 + 其它平台版本，按优先级排序并去掉重复。 */
export function playableCandidates(track: Track, order: readonly string[] = sourceOrder()): Track[] {
  const seen = new Set<string>()
  const list = [track, ...(track.versions ?? [])].filter((item) => {
    const key = `${item.source ?? 'local'}:${item.onlineId ?? item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return list.sort((a, b) => rank(a.source, order) - rank(b.source, order))
}

export interface PickedSource {
  /** 真正要播的那个版本。 */
  track: Track
  /** 已经能交给 audio 元素的地址。 */
  url: string
}

export async function pickPlayable(track: Track): Promise<PickedSource | null> {
  for (const candidate of playableCandidates(track)) {
    const direct = sourceFor(candidate).streamUrl(candidate)
    if (direct) return { track: candidate, url: direct }
    const fetched = await loadOnlineStream(candidate)
    if (fetched) return { track: candidate, url: fetched }
  }
  return null
}
