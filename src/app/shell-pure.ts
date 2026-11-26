import type { Route } from './routing.ts'

/**
 * 纯路由映射：地址栏写法、旧 `Route` 与新外壳之间的翻译。
 *
 * 单独一个文件、不带 window 与 localStorage：这张表最容易出错（少一条分支就是
 * 白屏，多一条就是两页抢一个地址），必须能被单测直接跑。启动时落哪一页
 * （initialShell）依赖 localStorage 与预览开关，留在 shell.ts。
 */
export type ShellView =
  /** 评论页：只认正在播的那一首，从播放页控制条进去。 */
  | 'comments'
  /* —— 左栏显示的 —— */
  | 'home'
  | 'daily'
  | 'liked'
  | 'recent'
  | 'collections'
  /** 关注的艺人：和收藏专辑同类，都是平台账号里的关系，不是本机曲库。 */
  | 'followedartists'
  /** 歌单：按平台分组，一页看完四个账号里的单子。 */
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
  | 'party'
  | 'sakura'
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
  comments: '评论',
  home: '推荐',
  daily: '每日推荐',
  liked: '我喜欢的音乐',
  recent: '最近播放',
  collections: '收藏专辑',
  followedartists: '关注艺人',
  playlists: '歌单',
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
  party: '一起听',
  /* 这一页现在以 Cloudflare 为主（在上面），樱花是备选，标题跟着实际内容走。 */
  sakura: '公网隧道',
  settings: '设置',
  me: '我',
  search: '搜索',
  sources: '音乐文件夹',
  netease: '网易云音乐',
  qq: 'QQ 音乐'
}

/**
 * 页头的英文眉标。
 *
 * 极光的语言是「一行技术感的英文小字压在中文标题上」——莱茵、死亡搁浅、
 * 尼尔都在用同一个手法：英文给气质，中文给信息，两层字号差三倍以上。
 * 这里只给通用页；详情页（专辑/歌单/艺人）自己的页头已经带了眉标，返回空串，
 * 免得同一行出现两个 PLAYLIST。
 */
export const SHELL_EYEBROWS: Record<ShellView, string> = {
  comments: 'COMMENTS',
  home: 'TODAY',
  daily: 'DAILY',
  liked: 'FAVORITES',
  recent: 'RECENT',
  collections: 'ALBUMS',
  followedartists: 'ARTISTS',
  playlists: 'PLAYLISTS',
  local: 'LIBRARY',
  album: 'ALBUM',
  artist: 'ARTIST',
  playlist: '',
  onlinealbum: '',
  onlineartist: '',
  onlineplaylist: '',
  track: '',
  nowplaying: '',
  stage: 'STAGE',
  party: 'PARTY',
  sakura: 'TUNNEL',
  settings: 'SETTINGS',
  me: 'PROFILE',
  search: 'SEARCH',
  sources: 'FOLDERS',
  netease: 'NETEASE',
  qq: 'QQ MUSIC'
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
  // 「漫游」不再是一页：它现在是一次播放会话。旧地址与旧书签落到播放页，
  // 那里如果正漫游着，底下就长着那条轨道。
  if (head === 'roam') return { view: 'nowplaying' }
  // 旧的「我的歌单」地址收进「歌单」：两页合成一页之后，旧书签不该白屏。
  const view = (head === 'myplaylists' ? 'playlists' : head) as ShellView
  // 只认表里自己有的键：`in` 会把 toString / constructor 这些原型链上的名字也放
  // 进来，地址栏敲一个 #toString 就得到一个空视图。
  if (!Object.hasOwn(SHELL_TITLES, view)) return null
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
    case 'playlists':
      return route.id ? { view: 'playlists', playlistId: route.id } : { view: 'discover' }
    case 'album':
      return { view: 'albums', albumId: route.id }
    case 'artist':
      return { view: 'artists', artistId: route.id }
    case 'playlist':
      return { view: 'playlists', playlistId: route.id }
    case 'me':
      return { view: 'accounts' }
    case 'party':
      return { view: 'party' }
    case 'sakura':
      return { view: 'sakura' }
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
