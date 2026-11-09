import type { ViewId } from '../types'

/**
 * 一页要显示哪一条数据。
 *
 * 壳（侧栏 / 地址 / 历史）自己有一套 ShellRoute，讲的是「你在哪一层」；
 * Route 只负责把 id 递给详情页。二级导航不在这里——它已经归壳管，
 * 页面不再各自记一份。
 */
export interface Route {
  view: ViewId
  artistId?: string
  albumId?: string
  playlistId?: string
}
