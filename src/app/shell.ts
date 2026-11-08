import { isNative } from '../bridge'
import { MENU_TEST_MODE, PERF_MODE, SCROLL_TEST_MODE } from './preview'
import type { Route } from './routing'

/**
 * 外壳路由：左栏那九项 + 它们各自的下一层。
 *
 * 这一层和 `routing.ts` 的 `Route` 不是一回事，也不该合成一个：
 *
 * - `ShellRoute` 描述「人在哪一页」，是导航模型，地址栏里能看见，左栏能点亮。
 * - `Route`（旧的）描述「哪一份数据被打开」，页面组件靠它取参数。
 *
 * 两层分开的好处是：页面组件一行不用改就能挂到新外壳下面，等某个页面真正重做时
 * 再把它从 `shellToRoute` 的映射里摘出来，换成自己的数据来源。眼下先全部沿用。
 */

export type ShellView =
  /* —— 左栏显示的 —— */
  | 'home'
  | 'roam'
  | 'daily'
  | 'liked'
  | 'recent'
  | 'collections'
  /** 自己建的歌单。新建入口只在这里。 */
  | 'myplaylists'
  /** 平台账号里收藏来的歌单，只读。 */
  | 'playlists'
  | 'local'
  | 'album'
  | 'artist'
  | 'playlist'
  /* 在线侧的同级三页：id 是 `provider/numericId`，与本地那三页分开走。 */
  | 'onlinealbum'
  | 'onlineartist'
  | 'onlineplaylist'
  | 'track'
  | 'nowplaying'
  | 'stage'
  | 'settings'
  | 'me'
  /* —— 不占左栏位置，但仍然是可达的页面 —— */
  | 'search'
  | 'sources'
  | 'netease'
  | 'qq'

export interface ShellRoute {
  view: ShellView
  /** 详情页的对象 id：专辑、艺人、歌单、歌曲。 */
  id?: string
}

/**
 * 页头标题。
 *
 * 一页只有一个标题，由外壳打；页面组件自己不再重复写一遍——这正是旧版「主页」
 * 出现两次的由来。详情页的标题是对象名，所以这里只给通用名。
 */
export const SHELL_TITLES: Record<ShellView, string> = {
  home: '推荐',
  roam: '漫游',
  daily: '每日推荐',
  liked: '我喜欢的音乐',
  recent: '最近播放',
  collections: '收藏专辑',
  myplaylists: '我的歌单',
  playlists: '收藏的歌单',
  local: '本机音乐',
  album: '专辑',
  artist: '艺人',
  playlist: '歌单',
  // 这三页自己的封面旁边就写着是什么，外壳再打一行标题就是重复。
  onlinealbum: '',
  onlineartist: '',
  onlineplaylist: '',
  track: '歌曲',
  nowplaying: '正在播放',
  stage: '舞台',
  settings: '设置',
  me: '我',
  search: '搜索',
  sources: '音乐文件夹',
  netease: '网易云音乐',
  qq: 'QQ 音乐'
}

/**
 * 地址栏里的写法。
 *
 * 详情页用 `album/<id>` 而不是 `album?id=`：hash 里带查询串在 Electron 里
 * 会被当成路径的一部分，后退时也难读。两段式最稳，刷新后还能落回同一张专辑。
 */
export function shellToHash(route: ShellRoute): string {
  // 在线详情页的 id 是两段（`netease/123`），逐段编码才能保持地址可读。
  const id = route.id?.split('/').map(encodeURIComponent).join('/')
  return id ? `${route.view}/${id}` : route.view
}

/** 解析地址栏；不认识的片段返回 null，交给调用方决定回落。 */
export function shellFromHash(raw: string): ShellRoute | null {
  const hash = raw.replace(/^#/, '').replace(/^\/+/, '')
  if (!hash) return null
  const [head, ...rest] = hash.split('/')
  if (!head) return null
  const view = head as ShellView
  if (!(view in SHELL_TITLES)) return null
  if (rest.length === 0) return { view }
  const id = decodeURIComponent(rest.join('/'))
  if (!id) return { view }
  // 只有详情类页面吃 id；其余片段带了 id 也不该悄悄变成另一个页面。
  if (
    view !== 'album' &&
    view !== 'artist' &&
    view !== 'playlist' &&
    view !== 'track' &&
    view !== 'onlinealbum' &&
    view !== 'onlineartist' &&
    view !== 'onlineplaylist'
  ) {
    return { view }
  }
  return { view, id }
}

/** 打开应用时落在哪一页。 */
export function initialShell(): ShellRoute {
  if (PERF_MODE) return { view: 'settings' }
  if (SCROLL_TEST_MODE) return { view: 'local' }
  if (MENU_TEST_MODE) return { view: 'local' }
  const parsed = shellFromHash(window.location.hash)
  if (parsed) return parsed
  // 打开就能听：推荐页未登录也有内容，曲库为空也不是一进来看空地。
  if (isNative) return { view: 'home' }
  // 旧书签（#songs / #collection 之类）仍然认，落到对应的新页面。
  return routeToShell(legacyRoute())
}

function legacyRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'empty') return { view: 'songs' }
  return { view: 'discover' }
}

/**
 * 页面组件只认旧的 `Route`。
 *
 * 这一层是过渡期的翻译器：新导航进来，翻译成旧参数，现有页面照常渲染。
 * 页面重做时把它从这张表里摘掉，改成直接读 `ShellRoute`。
 */
export function shellToRoute(route: ShellRoute): Route {
  switch (route.view) {
    case 'home':
      return { view: 'discover' }
    case 'daily':
      // 这一页自己取数，旧视图表里没有对应项，落一个安全的地方。
      return { view: 'discover' }
    case 'liked':
      return { view: 'collection', tab: 'liked' }
    case 'collections':
      // 收藏第一版只有一个落点：我喜欢的 + 我的歌单。真按专辑/艺人收藏要等后端
      // 给出「收藏了什么」的数据，在那之前不造一个空壳页面。
      return { view: 'collection', tab: 'liked' }
    case 'playlists':
      return route.id ? { view: 'playlists', playlistId: route.id } : { view: 'collection', tab: 'playlists' }
    // 这一页是外壳新增的，旧 `Route` 里没有对应项：它自己取数，不走翻译器。
    case 'myplaylists':
      return { view: 'discover' }
    case 'local':
      return { view: 'library', source: 'local', tab: 'songs' }
    case 'album':
      return { view: 'albums', albumId: route.id }
    case 'artist':
      return { view: 'artists', artistId: route.id }
    case 'playlist':
      return { view: 'playlists', playlistId: route.id }
    case 'me':
      return { view: 'accounts' }
    case 'settings':
      return { view: 'settings' }
    case 'search':
      return { view: 'search' }
    case 'sources':
      return { view: 'sources' }
    case 'netease':
      return { view: 'netease' }
    case 'qq':
      return { view: 'qq' }
    // 在线三页自己取数，旧视图表里没有对应项，给一个安全的落点。
    case 'onlinealbum':
    case 'onlineartist':
    case 'onlineplaylist':
    // 这三页还没有对应的旧视图，页面自己处理，这里给一个安全的落点。
    case 'recent':
    case 'nowplaying':
    case 'track':
    case 'roam':
    case 'stage':
      return { view: 'discover' }
    default:
      return { view: 'discover' }
  }
}

/**
 * 旧页面里的 `onNavigate(route)` 转成新导航。
 *
 * 页面组件并不知道外层换了导航模型，它们仍然按旧路由说话；这里把旧说法翻译
 * 成新地址。翻译不了的一律回推荐页，而不是留在原地点不动。
 */
export function routeToShell(route: Route): ShellRoute {
  switch (route.view) {
    case 'discover':
      return { view: 'home' }
    case 'collection':
      return route.tab === 'playlists' ? { view: 'playlists' } : { view: 'liked' }
    case 'library':
      return { view: 'local' }
    case 'albums':
      return route.albumId ? { view: 'album', id: route.albumId } : { view: 'home' }
    case 'artists':
      return route.artistId ? { view: 'artist', id: route.artistId } : { view: 'home' }
    case 'playlists':
      return route.playlistId ? { view: 'playlist', id: route.playlistId } : { view: 'playlists' }
    case 'accounts':
      return { view: 'me' }
    case 'settings':
      return { view: 'settings' }
    case 'search':
      return { view: 'search' }
    case 'sources':
      return { view: 'sources' }
    case 'netease':
      return { view: 'netease' }
    case 'qq':
      return { view: 'qq' }
    // songs / folders / albums 列表页：本机音乐的四个栏目现在收在「本机音乐」一页里，
    // 旧路由里直接指到某个栏目的链接，落到这一页就好。
    default:
      return { view: 'local' }
  }
}

/** 同一次导航：地址不同才算真的走了。 */
export function sameShell(a: ShellRoute, b: ShellRoute): boolean {
  return a.view === b.view && a.id === b.id
}
