import type { Track } from '../../types'
import { likeProviders } from './likes'
import type { LikeSource } from './like-source'

/**
 * 一首歌能收藏到哪几个地方。
 *
 * 合并行里一首歌常常同时存在本机文件与两三个平台，喜欢只写一个落点。
 * 这里把这一行里的每个版本摊开，按同一顺序给出「平台名 + 那一版」。
 * 平台只在「有喜欢接口且此刻可用」时出现，未接入或未就绪的平台不列，
 * 免得点下去只换来一句失败。
 */

export interface LikeTarget {
  source: LikeSource
  /** 界面上写给人看的名字：本机收藏，或平台的短名。 */
  label: string
  /** 要写进那个来源的那一版。 */
  track: Track
}

export function likeTargets(track: Track): LikeTarget[] {
  const platforms = new Map(likeProviders().map((provider) => [provider.id, provider]))
  const out: LikeTarget[] = []
  const seen = new Set<string>()

  for (const version of [track, ...(track.versions ?? [])]) {
    const source = version.source && version.source !== 'local' ? version.source : 'local'
    if (seen.has(source)) continue

    if (source === 'local') {
      seen.add(source)
      out.push({ source, label: '本机收藏', track: version })
      continue
    }

    const provider = platforms.get(source)
    if (!provider) continue
    seen.add(source)
    out.push({ source, label: provider.shortName ?? provider.displayName, track: version })
  }

  return out
}
