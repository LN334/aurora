import { isNative } from '../bridge'
import { MENU_TEST_MODE, PERF_MODE, SCROLL_TEST_MODE } from './preview'
import type { ViewId } from '../types'

/**
 * Routes, screen titles, and which screen the app opens on.
 *
 * 一级导航只有四项：发现 / 音乐库 / 搜索 / 设置。
 *
 * 这三件事以前都在侧栏里各有入口：每个平台一组、本地音乐四项、设置三项。
 * 结果是「本地音乐」被拆成四个一级项，和网易云并排看着像两个应用；账号与音源
 * 又各自成页，设置被切碎。平台和本地文件都不是一级目的地，它们是「音乐库」的
 * 来源维度；账号属于设置。详情页（专辑/艺术家/歌单）保留为独立路由，因为只有
 * 它们需要自己的返回按钮和「上一页」历史。
 */

export const VIEW_TITLES: Record<ViewId, string> = {
  discover: '主页',
  library: '音乐库',
  albums: '专辑',
  artists: '艺术家',
  songs: '歌曲',
  folders: '文件夹',
  playlists: '播放列表',
  accounts: '账号',
  sources: '音源',
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  search: '搜索',
  settings: '设置'
}

/** 侧栏上的四个一级入口。详情页按它被打开的那一层归类。 */
export type NavGroup = 'discover' | 'library' | 'search' | 'settings'

export function navGroupOf(view: ViewId): NavGroup | null {
  if (view === 'discover') return 'discover'
  if (view === 'search') return 'search'
  if (view === 'settings') return 'settings'
  // 账号页没有对应的一级入口：它从侧栏底部那张头像进去，不是第四个目的地。
  // 返回 null 表示「这三个一级项这次都不要点亮」。
  if (view === 'accounts' || view === 'sources') return null
  // albums / artists / songs / folders / playlists / library / 各平台页面
  return 'library'
}

export interface Route {
  view: ViewId
  artistId?: string
  albumId?: string
  playlistId?: string
  /**
   * 音乐库的来源：'local' 或平台 id。
   *
   * 它住在路由里而不是组件状态里，这样「返回」能回到你刚才看的那一栏，
   * 而不是回到这页默认的第一个 tab。
   */
  source?: string
  /** 音乐库本机来源下打开的栏目（songs/albums/artists/playlists/folders）。 */
  tab?: string
}

export function initialRoute(): Route {
  // 打开就能听：发现页在未登录时也有公开内容，曲库为空也不再是一进来看空地。
  if (isNative) return { view: 'discover' }
  if (PERF_MODE) return { view: 'settings' }
  if (SCROLL_TEST_MODE) return { view: 'songs' }
  if (MENU_TEST_MODE) return { view: 'songs' }
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'empty') return { view: 'songs' }
  if (hash in VIEW_TITLES) return { view: hash as ViewId }
  return { view: 'discover' }
}

/** 这些视图展示本机文件，所以「重新扫描 / 添加文件夹」只出现在它们上面。 */
export const LIBRARY_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>([
  'library',
  'albums',
  'artists',
  'songs',
  'folders',
  'playlists'
])
