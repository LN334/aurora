import { useAccounts } from '../features/accounts/store'
import { useOnlineBindings } from '../features/accounts/bindings'
import { useFavorites } from '../features/favorites/store'
import { useRecentEntries } from '../features/player/history-store'
import { usePlaylists } from '../features/playlists/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { Artwork } from '../ui/Artwork'
import { Album, Compass, Heart, List, Refresh, Settings, Sidebar, User } from '../ui/icons'
import { BrandMark } from './BrandMark'
import type { ShellRoute, ShellView } from './shell'

/**
 * 左栏：一条「我现在要去哪」的路，不是一张功能清单。
 *
 * 分三段，每段只有一个意思：
 *
 * 1. 顶上一颗：现在。它是默认落点，也是唯一一页会自己变（问候、正在播放、
 *    今天听什么），所以放在所有列表上面。
 * 2. 两格人的判断与行为：我喜欢的、最近播放。这两个不是曲库的栏目，是「我
 *    做过什么」，跟库存放什么无关，所以单列一段。
 * 3. 「库」：歌单 / 专辑 / 艺人。这三条是同一件事的三个切面——把已有的东西
 *    换个维度排一遍。它们共用一个分组标题，因为加上标题之后「这三项是一类」
 *    才成立；不分组、跟上面两格平铺，会让人以为歌单和「我喜欢的」同级。
 *
 * 平台不在这栏里。网易云、QQ、酷狗、汽水是来源，不是目的地；给平台一个平级
 * 入口就会长出四个几乎一样的页面。账号在底部那一格里。
 *
 * 漫游也不在这栏里：它不是一个「库」，是「随便放点什么」的动作，所以挪到顶栏。
 */
interface RailProps {
  route: ShellRoute
  onNavigate: (route: ShellRoute) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 当前档案名，显示在底部；档案是设置里的第一个分区，不是导航项。 */
  profileLabel: string | null
  onOpenProfile: () => void
  albumCount: number
  artistCount: number
}

interface RailItem {
  view: ShellView
  label: string
  icon: typeof Compass
}

/** 「库」那一段：同一批东西的三种排法。 */
const SHELF: RailItem[] = [
  { view: 'playlists', label: '歌单', icon: List },
  { view: 'album', label: '专辑', icon: Album },
  { view: 'artist', label: '艺人', icon: User }
]

const FOOT: RailItem[] = [{ view: 'settings', label: '设置', icon: Settings }]

export function Rail({
  route,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  profileLabel,
  onOpenProfile,
  albumCount,
  artistCount
}: RailProps) {
  /*
   * 侧栏底部这一行的头像跟「我」页的档案卡必须是同一张：先看档案自己设的头像，
   * 没设过就用该档案绑定的在线账号头像（网易云那种彩色头像是账号最有辨识度的
   * 部分），都没有才回落到档案名首字。
   */
  const accounts = useAccounts((state) => state.accounts)
  const activeId = useAccounts((state) => state.activeId)
  const bindings = useOnlineBindings(accounts)
  const active = accounts.find((account) => account.id === activeId) ?? null
  const boundAvatar = activeId ? (bindings[activeId]?.avatarUrl ?? null) : null
  const avatar = active?.avatar ?? (boundAvatar ? remoteImageUrl(sizedImage(boundAvatar, 96), 96) : null)
  const fallbackAvatar = <User size={16} />

  const likedCount = useFavorites((state) => state.liked.length)
  const recentCount = useRecentEntries().length
  const playlistCount = usePlaylists((state) => state.playlists.length)

  /*
   * 详情页要点亮它属于哪一条线：专辑、艺人的详情各自回到自己那一格，歌单
   * （本地建的与平台收的）都算「歌单」。歌曲详情从任何一页都可能进去，
   * 就不点亮任何一格——返回靠顶栏的前进后退。
   */
  const owner = (view: ShellView): ShellView => {
    if (view === 'playlist' || view === 'onlineplaylist') return 'playlists'
    if (view === 'onlinealbum') return 'album'
    if (view === 'onlineartist') return 'artist'
    return view
  }
  const lit = owner(route.view)

  const countFor = (view: ShellView): number | null => {
    if (view === 'liked') return likedCount
    if (view === 'recent') return recentCount
    if (view === 'playlists') return playlistCount
    if (view === 'album') return albumCount
    if (view === 'artist') return artistCount
    return null
  }

  const item = (view: ShellView, label: string, Icon: typeof Compass, count: number | null) => {
    const on = lit === view
    return (
      <button
        key={view}
        className={`rail-item${on ? ' is-active' : ''}`}
        onClick={() => onNavigate({ view })}
        aria-current={on ? 'page' : undefined}
        title={collapsed ? label : undefined}
      >
        <Icon size={16} />
        <span className="rail-item__label">{label}</span>
        {count !== null && count > 0 ? (
          <span className="rail-item__count">{count > 9999 ? '9999+' : count.toLocaleString()}</span>
        ) : null}
      </button>
    )
  }

  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail__brand" title="Aurora">
        <BrandMark size={20} />
        <span>Aurora</span>
      </div>

      <div className="rail__scroll">
        {item('home', '现在', Compass, null)}
        {item('liked', '我喜欢的', Heart, countFor('liked'))}
        {item('recent', '最近播放', Refresh, countFor('recent'))}

        <div className="rail__caption">库</div>
        {SHELF.map((entry) => item(entry.view, entry.label, entry.icon, countFor(entry.view)))}
      </div>

      <div className="rail__foot">
        {FOOT.map((entry) => item(entry.view, entry.label, entry.icon, null))}

        {/* 「我」用当前档案的头像当图标：这一行本来就是这个意思。 */}
        <button
          className={`rail-item${lit === 'me' ? ' is-active' : ''}`}
          onClick={onOpenProfile}
          aria-current={lit === 'me' ? 'page' : undefined}
          title={profileLabel ? `当前档案：${profileLabel}` : '我'}
        >
          <span className="rail-item__avatar">
            {avatar ? <Artwork src={avatar} fallback={fallbackAvatar} /> : fallbackAvatar}
          </span>
          <span className="rail-item__label">{profileLabel ?? '我'}</span>
        </button>

        <button
          className="rail-item rail-item--quiet"
          onClick={onToggleCollapsed}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <Sidebar size={16} />
          <span className="rail-item__label">收起侧栏</span>
        </button>
      </div>
    </nav>
  )
}
