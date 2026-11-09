import type { Track } from '../../types'
import { sourceLabelById } from '../online/registry'
import { likeProviders } from './likes'
import type { LikeSource } from './like-source'

/**
 * 一首歌的每个版本，以及这个版本能不能被收藏。
 *
 * 两个用途、两种过滤：
 * - 行上的心形按钮只关心「能写到几个地方」，可写的为 0 就提示、为 1 就直接切、
 *   多于 1 才让用户选（`writableTargets`）；
 * - 选落点的面板要把不能写的平台也列出来并说明原因，否则用户会以为那家平台
 *   「不见了」，而实际是它没有收藏接口（`likeTargets`）。
 */

export interface LikeTarget {
  source: LikeSource
  /** 界面上写给人看的名字：本机收藏，或平台的短名。 */
  label: string
  /** 要写进那个来源的那一版。 */
  track: Track
  /** 这家有没有「加入我喜欢的歌」的接口。本机收藏恒为真。 */
  writable: boolean
}

export function likeTargets(track: Track): LikeTarget[] {
  const platforms = new Map(likeProviders().map((provider) => [provider.id, provider]))
  const out: LikeTarget[] = []
  const seen = new Set<string>()

  for (const version of [track, ...(track.versions ?? [])]) {
    const source = version.source && version.source !== 'local' ? version.source : 'local'
    if (seen.has(source)) continue
    seen.add(source)

    if (source === 'local') {
      out.push({ source, label: '本机收藏', track: version, writable: true })
      continue
    }

    const provider = platforms.get(source)
    out.push({
      source,
      label: provider?.shortName ?? provider?.displayName ?? sourceLabelById(source),
      track: version,
      writable: Boolean(provider)
    })
  }

  return out
}
