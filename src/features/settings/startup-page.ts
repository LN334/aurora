import type { ShellView } from '../../app/shell'

/**
 * 启动时落在哪一页。
 *
 * 和别的界面偏好一样存 localStorage：它只决定渲染层的第一个路由，主进程不需要
 * 知道，也不需要为它多开一条 IPC。'last' 是默认——大多数人第二天打开还是想接着
 * 上次那页，但只记不带 id 的稳定页，详情页（某张专辑、某个歌单）不还原：那些 id
 * 属于上一次的曲库，换一个资料库就指向空处。
 */
export type StartupPage = 'last' | 'home' | 'daily' | 'liked' | 'local' | 'nowplaying' | 'playlists'

const KEY = 'aurora.startup.page'
const LAST_KEY = 'aurora.startup.last'

export const STARTUP_PAGES: { id: StartupPage; name: string; hint: string }[] = [
  { id: 'last', name: '上次那页', hint: '接着上次离开的地方，不还原到具体某张专辑。' },
  { id: 'home', name: '首页', hint: '每次打开都从推荐开始。' },
  { id: 'daily', name: '每日推荐', hint: '打开就能看到今天这批。' },
  { id: 'liked', name: '我喜欢的', hint: '直接从收藏开始听。' },
  { id: 'local', name: '本机音乐', hint: '只放硬盘上的文件。' },
  { id: 'nowplaying', name: '正在播放', hint: '进来就是播放页，适合接着放。' },
  { id: 'playlists', name: '歌单', hint: '打开自己的歌单列表。' }
]

/** 可以记成「上次那页」的视图：稳定、不需要参数。 */
const REMEMBERABLE: ShellView[] = [
  'home',
  'daily',
  'liked',
  'recent',
  'collections',
  'followedartists',
  'playlists',
  'local',
  'nowplaying',
  'party'
]

const LAST_VIEWS = new Set<ShellView>(REMEMBERABLE)
const PAGES = new Set<StartupPage>(STARTUP_PAGES.map((item) => item.id))

export function readStartupPage(): StartupPage {
  const raw = localStorage.getItem(KEY)
  return raw && PAGES.has(raw as StartupPage) ? (raw as StartupPage) : 'last'
}

export function writeStartupPage(page: StartupPage): void {
  localStorage.setItem(KEY, page)
}

export function readLastView(): ShellView | null {
  const raw = localStorage.getItem(LAST_KEY)
  return raw && LAST_VIEWS.has(raw as ShellView) ? (raw as ShellView) : null
}

export function rememberView(view: ShellView): void {
  if (!LAST_VIEWS.has(view)) return
  if (localStorage.getItem(LAST_KEY) !== view) localStorage.setItem(LAST_KEY, view)
}
