import { useAccounts } from '../features/accounts/store'
import { useOnlineBindings } from '../features/accounts/bindings'
import { useFavorites } from '../features/favorites/store'
import { useRecentEntries } from '../features/player/history-store'
import { useRoam } from '../features/player/roam-session'
import { useUpdate } from '../features/updates/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { Artwork } from '../ui/Artwork'
import { Album, Compass, Folder, Heart, List, Refresh, Settings, Shuffle, Sidebar, User } from '../ui/icons'
import type { ShellRoute, ShellView } from './shell'

/**
 * 左栏：一条「我现在要去哪」的路，不是一张功能清单。
 *
 * 分三段，每段只有一个意思：
 *
 * 1. 顶上两颗都是「不用挑、直接听」：现在（默认落点，唯一一页会自己变）与
 *    漫游（随机放点什么）。漫游曾经在顶栏当动作、又在左栏当过第四格，最后落在
 *    这里：它确实不是一个库，但「现在」也不是——这两件事是同一类。
 * 2. 两格人的判断与行为：我喜欢的、最近播放。这两个不是曲库的栏目，是「我
 *    做过什么」，跟库存放什么无关，所以单列一段。
 * 3. 「库」：歌单 / 专辑 / 艺人。这三条是同一件事的三个切面——把已有的东西
 *    换个维度排一遍。它们共用一个分组标题，因为加上标题之后「这三项是一类」
 *    才成立；不分组、跟上面两格平铺，会让人以为歌单和「我喜欢的」同级。
 *
 * 平台不在这栏里。网易云、QQ、酷狗、汽水是来源，不是目的地；给平台一个平级
 * 入口就会长出四个几乎一样的页面。账号在底部那一格里。
 */
interface RailProps {
  route: ShellRoute
  onNavigate: (route: ShellRoute) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 当前档案名，显示在底部；档案是设置里的第一个分区，不是导航项。 */
  profileLabel: string | null
  onOpenProfile: () => void
  /** 四家账号里歌单的合计：左栏那个数字说的是「平台上有多少张」，不是本机建过几张。 */
  playlistCount: number
  albumCount: number
  artistCount: number
  /** 随机放点什么。左栏之所以收它，见文件头的注释。 */
  onRoam: () => void
  /** 正在要第一趟。按钮在这期间不能连点，否则会并行发两轮请求。 */
  roamBusy?: boolean
  /** 这一趟还活着：按钮右上角点一颗点，说明漫游没结束。 */
  roaming?: boolean
}

interface RailItem {
  view: ShellView
  label: string
  icon: typeof Compass
}

/**
 * 「库」那一段：我手上有什么——歌单、专辑、艺人，再加这一台机器上的文件。
 *
 * 前三样问的是平台账号（收藏来的、关注来的），最后一样问磁盘。本机的歌、专辑、
 * 艺人收在「本机」那一页的标签里，所以不另开两个入口——「专辑」「艺人」以前打开
 * 的正是那两面本地的墙，看着像收藏其实是磁盘，这就是「怎么还是本地」的由来。
 */
const SHELF: RailItem[] = [
  { view: 'playlists', label: '歌单', icon: List },
  { view: 'collections', label: '专辑', icon: Album },
  { view: 'followedartists', label: '艺人', icon: User },
  { view: 'local', label: '本机', icon: Folder }
]

const FOOT: RailItem[] = [{ view: 'settings', label: '设置', icon: Settings }]

export function Rail({
  route,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  profileLabel,
  onOpenProfile,
  playlistCount,
  albumCount,
  artistCount,
  onRoam,
  roamBusy,
  roaming
}: RailProps) {
  // 漫游状态直接订阅 store：接与不接由这一份状态决定，不该再从外面传两遍。
  const roamLive = useRoam((state) => state.tracks.length > 0)
  const roamPending = useRoam((state) => state.busy)
  const live = roaming ?? roamLive
  const pending = roamBusy ?? roamPending
  // 查到了新版本、还没去看，就在「设置」上留一颗点；别为它单开一条横幅。
  const updateReady = useUpdate((state) => state.result?.state === 'available' && !state.noted)
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

  /*
   * 详情页要点亮它属于哪一条线：专辑、艺人的详情各自回到自己那一格，歌单
   * （本地建的与平台收的）都算「歌单」。歌曲详情从任何一页都可能进去，
   * 就不点亮任何一格——返回靠顶栏的前进后退。
   */
  const owner = (view: ShellView): ShellView => {
    if (view === 'playlist' || view === 'onlineplaylist') return 'playlists'
    // 本地专辑/艺人详情是从「本机音乐」走进来的，点亮那一格才对得上来路。
    if (view === 'album' || view === 'artist') return 'local'
    if (view === 'onlinealbum') return 'collections'
    if (view === 'onlineartist') return 'followedartists'
    return view
  }
  const lit = owner(route.view)

  const countFor = (view: ShellView): number | null => {
    if (view === 'liked') return likedCount
    if (view === 'recent') return recentCount
    if (view === 'playlists') return playlistCount
    if (view === 'collections') return albumCount
    if (view === 'followedartists') return artistCount
    return null
  }

  const item = (
    view: ShellView,
    label: string,
    Icon: typeof Compass,
    count: number | null,
    dot = false
  ) => {
    const on = lit === view
    const title = dot
      ? label + ' · 有新版本'
      : collapsed
        ? label
        : undefined
    return (
      <button
        key={view}
        className={`rail-item${on ? ' is-active' : ''}`}
        onClick={() => onNavigate({ view })}
        aria-current={on ? 'page' : undefined}
        title={title}
      >
        <Icon size={16} />
        <span className="rail-item__label">{label}</span>
        {count !== null && count > 0 ? (
          <span className="rail-item__count">{count > 9999 ? '9999+' : count.toLocaleString()}</span>
        ) : null}
        {dot ? <span className="rail-item__dot rail-item__dot--update" aria-hidden="true" /> : null}
      </button>
    )
  }

  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail__scroll">
        {item('home', '现在', Compass, null)}
        {/*
          * 漫游是一个动词，所以它不跟「歌单 / 专辑 / 艺人」共用「库」那个标题。
          * 它现在也不是一页：点下去换掉队列、进播放页，底下长出漫游轨。所以按钮
          * 不点亮任何页面，只用右上角那颗点表示「这一趟还活着」。
          */}
        <button
          className={`rail-item rail-item--roam${live ? ' is-live' : ''}`}
          onClick={() => onRoam()}
          disabled={pending}
          title={pending ? '正在向平台要歌…' : live ? '漫游中 · 再点一次接着听 (R)' : '随机放点什么 (R)'}
          aria-label="漫游"
        >
          {pending ? <span className="rail-item__spin" aria-hidden="true" /> : <Shuffle size={16} />}
          <span className="rail-item__label">漫游</span>
          {live ? <span className="rail-item__dot" aria-hidden="true" /> : null}
        </button>
        {item('liked', '我喜欢的', Heart, countFor('liked'))}
        {item('recent', '最近播放', Refresh, countFor('recent'))}

        <div className="rail__caption">库</div>
        {SHELF.map((entry) => item(entry.view, entry.label, entry.icon, countFor(entry.view)))}
      </div>

      <div className="rail__foot">
        {FOOT.map((entry) =>
          item(entry.view, entry.label, entry.icon, null, entry.view === 'settings' && updateReady)
        )}

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
