import { useAccounts } from '../features/accounts/store'
import { useOnlineBindings } from '../features/accounts/bindings'
import { useFavorites } from '../features/favorites/store'
import { useLibrary } from '../features/library/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { Artwork } from '../ui/Artwork'
import { Compass, Heart, Library, List, Note, Refresh, Settings, Shuffle, Sidebar, User } from '../ui/icons'
import type { ShellRoute, ShellView } from './shell'

/**
 * 左栏：一列「去哪」，不是一列「东西从哪来」。
 *
 * 参考的是网易云自己的侧栏结构（3.1.43 解包后的 `subApp.chunk` 里那份定义）：
 * 上一段是发现（推荐 / 精选 / 播客 / 漫游 / 关注），下一段标题只有一个「我的」，
 * 里面并排放着我喜欢的音乐、最近播放、我的收藏、下载、本地音乐、云盘。
 *
 * 两个刻意的决定：
 *
 * 1. 没有「库」这一层。旧版有一个叫「音乐库」的一级项，点进去只有硬盘上的文件，
 *    于是「我到底有哪些音乐」这个问题没有任何一页能回答。现在「本机音乐」就写它
 *    本来的意思，和「我喜欢的」「最近播放」平级，各自说清楚装的是什么。
 * 2. 平台不在这栏里。网易云和 QQ 是来源，不是目的地；它们的内容通过顶栏那颗
 *    来源胶囊进入各页，账号在「我」里面。给平台一个平级入口，就会长出四个几乎
 *    一样的页面。
 */

interface RailProps {
  route: ShellRoute
  onNavigate: (route: ShellRoute) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 当前档案名，显示在底部；档案是设置里的第一个分区，不是导航项。 */
  profileLabel: string | null
  onOpenProfile: () => void
}

interface MineItem {
  view: ShellView
  label: string
  icon: typeof Compass
}

/**
 * 「我的」那一段：喜欢 → 最近 → 歌单 → 收藏专辑 → 本地。
 *
 * 歌单只占一格：自己建的和从别人那里收的都在里面，进页面按平台分开看。以前拆
 * 成「我的歌单」和「收藏歌单」两格，等于把「谁建的」当成导航层级——用户脑子里
 * 那件事是「哪家的歌单」，不是「我建的还是收的」。
 *
 * 每日推荐不在这栏里：入口就是主页那块「今天听什么」，一天只换一次。
 */
const MINE: MineItem[] = [
  { view: 'liked', label: '我喜欢的音乐', icon: Heart },
  { view: 'recent', label: '最近播放', icon: Refresh },
  { view: 'playlists', label: '歌单', icon: List },
  { view: 'collections', label: '收藏专辑', icon: Note },
  { view: 'local', label: '本机音乐', icon: Library }
]

/**
 * 左栏底部：设置，加上底部那一格档案。
 *
 * 舞台不在这里。它不是「去哪一页」，是「把正在听的东西摊满窗口」——所以入口
 * 跟着播放走：点播放条左边那张封面、按 L、或点播放条右侧的展开键。网易云、
 * Spotify、Apple Music 都是这么放的，左栏放一个「舞台」等于把播放态塞进导航，
 * 还会让「这是页面还是模式」分不清。
 */
const FOOT: MineItem[] = [{ view: 'settings', label: '设置', icon: Settings }]

export function Rail({
  route,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  profileLabel,
  onOpenProfile
}: RailProps) {
  /*
   * 侧栏底部这一行的头像跟「我」页的档案卡必须是同一张：先看档案自己设的头像，
   * 没设过就用该档案绑定的在线账号头像（网易云那种彩色头像是账号最有辨识度的部分），
   * 都没有才回落到档案名首字。
   */
  const accounts = useAccounts((state) => state.accounts)
  const activeId = useAccounts((state) => state.activeId)
  const bindings = useOnlineBindings(accounts)
  const active = accounts.find((account) => account.id === activeId) ?? null
  const boundAvatar = activeId ? (bindings[activeId]?.avatarUrl ?? null) : null
  const avatar = active?.avatar ?? (boundAvatar ? remoteImageUrl(sizedImage(boundAvatar, 96), 96) : null)
  const fallbackAvatar = <User size={17} />

  const likedCount = useFavorites((state) => state.liked.length)
  const trackCount = useLibrary((state) => state.tracks.length)

  const countFor = (view: ShellView): number | null => {
    if (view === 'liked') return likedCount
    // 歌单要联网才知道有几张，等页面自己报，不在这里预取。
    if (view === 'local') return trackCount
    return null
  }

  /*
   * 详情页要点亮它属于哪一条线：专辑/艺人在本机音乐里，本机歌单在「我的歌单」，
   * 平台歌单在「收藏的歌单」，歌曲详情从任何一页都可能进去，就不点亮（返回靠
   * 标题栏的返回键）。
   */
  const activeOwner = (view: ShellView): ShellView | null => {
    if (view === 'album' || view === 'artist') return 'local'
    if (view === 'playlist' || view === 'onlineplaylist') return 'playlists'
    return view
  }
  const lit = activeOwner(route.view)

  const item = (view: ShellView, label: string, Icon: typeof Compass, count: number | null) => {
    const on = lit === view
    return (
      <button
        key={view}
        className={`nav-item${on ? ' is-active' : ''}`}
        onClick={() => onNavigate({ view })}
        aria-current={on ? 'page' : undefined}
        title={collapsed ? label : undefined}
      >
        <Icon size={17} />
        <span className="nav-item__label">{label}</span>
        {count !== null && count > 0 ? (
          <span className="nav-item__count">{count > 9999 ? '9999+' : count.toLocaleString()}</span>
        ) : null}
      </button>
    )
  }

  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail__scroll">
        {item('home', '推荐', Compass, null)}
        {item('roam', '漫游', Shuffle, null)}

        <div className="rail__caption">我的</div>
        {MINE.map((entry) => item(entry.view, entry.label, entry.icon, countFor(entry.view)))}

      </div>

      <div className="rail-toggle">
        {FOOT.map((entry) => item(entry.view, entry.label, entry.icon, null))}

        {/* 「我」用当前档案的头像当图标：这一行本来就是这个意思。 */}
        <button
          className={`nav-item${lit === 'me' ? ' is-active' : ''}`}
          onClick={onOpenProfile}
          aria-current={lit === 'me' ? 'page' : undefined}
          title={profileLabel ? `当前档案：${profileLabel}` : '我'}
        >
          <span className="rail__avatar">
            {avatar ? <Artwork src={avatar} fallback={fallbackAvatar} /> : fallbackAvatar}
          </span>
          <span className="nav-item__label">{profileLabel ?? '我'}</span>
        </button>

        <button
          className="nav-item"
          onClick={onToggleCollapsed}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <Sidebar size={17} />
          <span className="nav-item__label">收起侧栏</span>
        </button>
      </div>
    </nav>
  )
}
