import type { ShellRoute } from '../../app/shell'
import { useOnlineStore, type PlaylistFace } from '../online/store'

/**
 * 「去这个专辑 / 艺人 / 歌单的页面」——从歌曲行里那两个名字点出去。
 *
 * 用模块级的注册表而不是 React context：能点的地方太多（搜索结果、在线歌单、
 * 每日推荐、我的收藏），一路往下传 props 会让每一层列表都知道「详情页」存在。
 * 外壳在挂载时把导航函数交进来，行里只负责说「我要去哪一页」。
 */
let navigate: ((route: ShellRoute) => void) | null = null

export function bindDetailNavigate(fn: (route: ShellRoute) => void): void {
  navigate = fn
}

/** 详情页的 id 一律是 `provider/numericId`，两段一起进 hash。 */
function idOf(providerId: string, id: number): string {
  return `${providerId}/${id}`
}

export function openOnlineAlbum(providerId: string, id: number): void {
  navigate?.({ view: 'onlinealbum', id: idOf(providerId, id) })
}

export function openOnlineArtist(providerId: string, id: number): void {
  navigate?.({ view: 'onlineartist', id: idOf(providerId, id) })
}

/** 这一行能不能点进专辑 / 艺人页。没有 id 的平台一律不装作能点。 */
export function refOfTrack(track: { source?: string; albumId?: number; artistId?: number }): {
  album: number | null
  artist: number | null
} {
  if (track.source !== 'netease') return { album: null, artist: null }
  return { album: track.albumId ?? null, artist: track.artistId ?? null }
}

/**
 * 打开一张平台歌单。
 *
 * 顺手把卡片上的名字 / 封面 / 创建者记进那一侧的 store：详情页的头部就靠这三样，
 * 而推荐位上的单子往往不在「我的歌单」里。不记的话页面只能显示「歌单」和空封面。
 */
export function openOnlinePlaylist(
  providerId: string,
  playlist: Pick<PlaylistFace, 'id' | 'name' | 'coverUrl'> & { creator?: string }
): void {
  useOnlineStore(providerId)
    .getState()
    .rememberPlaylist({
      id: playlist.id,
      name: playlist.name,
      coverUrl: playlist.coverUrl,
      creator: playlist.creator ?? ''
    })
  navigate?.({ view: 'onlineplaylist', id: idOf(providerId, playlist.id) })
}

/** `netease/123` -> 两段。解析不了就给 null，页面自己回落。 */
export function parseRefId(raw: string | undefined): { providerId: string; id: number } | null {
  if (!raw) return null
  const [providerId, tail] = raw.split('/')
  const id = Number(tail)
  if (!providerId || !Number.isFinite(id) || id <= 0) return null
  return { providerId, id }
}
