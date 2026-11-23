import { sourceFor } from '../library/source'
import { sourceOrder } from '../settings/source-order'
import { resolveSharedUrl, sharedStreamFor } from '../party/shared-stream'
import { relayStreamUrl } from './urls'
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
function playableCandidates(track: Track, order: readonly string[] = sourceOrder()): Track[] {
  const seen = new Set<string>()
  const list = [track, ...(track.versions ?? [])].filter((item) => {
    const key = `${item.source ?? 'local'}:${item.onlineId ?? item.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return list.sort((a, b) => rank(a.source, order) - rank(b.source, order))
}

interface PickedSource {
  /** 真正要播的那个版本。 */
  track: Track
  /** 已经能交给 audio 元素的地址。 */
  url: string
}

export async function pickPlayable(
  track: Track,
  opts: { force?: boolean } = {}
): Promise<PickedSource | null> {
  /*
   * 一起听里，房主那份地址优先。
   *
   * 这不是「客人取不到才兜底」——那会让两个人听着两个音质。房主选了母带，
   * 客人听到的就该是母带；他自己账号能给什么档与这件事无关。
   */
  const shared = sharedStreamFor(track.id)
  if (shared) {
    /*
     * 转发给的是路径，主机在这里补——用的是「我连进来时的那个地址」。房主填了
     * 公网地址时，同一 WiFi 的客人也不会被绕到公网去。
     *
     * 页面 CSP 不允许外域音频，引擎又走 Web Audio，跨源会被静音，所以还要包
     * 成 aurora-remote 由本机主进程代拉。
     */
    const target = resolveSharedUrl(shared)
    if (target) {
      const url = target.startsWith('aurora-') ? target : relayStreamUrl(target)
      return { track, url }
    }
  }

  for (const candidate of playableCandidates(track)) {
    /*
     * force：缓存里那条地址刚被媒体元素拒过。再把它交出去只会再失败一次，所以
     * 跳过同步命中，直接走到「去上游要一份新的」。
     */
    const direct = opts.force ? null : sourceFor(candidate).streamUrl(candidate)
    if (direct) return { track: candidate, url: direct }
    const fetched = await loadOnlineStream(candidate, opts)
    if (fetched) return { track: candidate, url: fetched }
  }
  return null
}
