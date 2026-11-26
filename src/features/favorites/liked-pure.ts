import type { Track } from '../../types'

/**
 * 这一首歌（合并行）在喜欢集合里吗。
 *
 * 合并行的主行只是「优先级最高的那一版」；用户可能喜欢的是挂在后面另一家的
 * 那一版。只看主行会让心形明明收藏过却还是空的——列表行早就是这么判的
 * （见 TrackList 的 likedSourcesOf），这里把同一条规则给其余几处用。
 *
 * 单独一个文件、不带 React 与 store：判定要能被单测直接跑，也要能被六处
 * 界面共用，而不必各自 import 整个喜欢模块。
 */
export function isTrackLiked(track: Track | null | undefined, ids: ReadonlySet<string>): boolean {
  if (!track) return false
  if (ids.has(track.id)) return true
  return (track.versions ?? []).some((version) => ids.has(version.id))
}
