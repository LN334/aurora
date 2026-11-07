import type { ComponentType } from 'react'
import { navGroupOf, type NavGroup, type Route } from './routing'
import type { ViewId } from '../types'
import { useAccounts } from '../features/accounts/store'
import { useOnlineBindings } from '../features/accounts/bindings'
import { useFavorites } from '../features/favorites/store'
import { usePlaylists } from '../features/playlists/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { Artwork } from '../ui/Artwork'
import { Compass, Heart, Library, Settings, Sidebar, User } from '../ui/icons'

/**
 * The rail: three destinations, one per intent.
 *
 * 以前这里按平台和媒体类型分组：网易云一组（含每日推荐、红心、云盘、歌单）、
 * QQ 一组、歌单一组、本地音乐四项、设置三项。平台数和本地分类数都在长，而这个
 * 栏位不区分「你要去哪」和「东西从哪来」——于是本地音乐看起来像一个和网易云
 * 平级的应用，设置被切成三页。
 *
 * 一级是四项：主页（接着听什么）、音乐库（磁盘上有什么）、收藏（我挑过什么）、
 * 设置。音乐库和收藏是两条不同的组织线，不是一个东西的两半：前者由文件决定
 * 栏目，后者由人决定，所以歌单和喜欢都归收藏。
 *
 * 一级下面挂子项，但只挂「同一件事的下一层」：
 * - 主页不挂子项：最近播放、我的音乐、为你挑选、今日聆听都是这一页里的区块，
 *   一页滚下去就能看到，再给一份重复的目录没有意义；
 * - 音乐库挂它自己的栏目（歌曲、专辑、艺术家、文件夹）；
 * - 收藏挂「我喜欢的歌曲」「我的歌单」和每个歌单本身。
 *   平台账号主页不在这里：它从侧栏底部的头像进。
 *
 * 平台页（网易云 / QQ 音乐）曾经也在这里当来源标签，那是把它们当成了曲库。它们
 * 打开的是账号主页，所以现在从账号页进。
 */

interface RailProps {
  route: Route
  onNavigate: (route: Route) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 当前档案名，显示在底部；档案是设置的第一个分区，不是导航项。 */
  profileLabel: string | null
  onOpenProfile: () => void
}

interface PrimaryItem {
  group: NavGroup
  /** 点了之后落到的视图。 */
  view: ViewId
  label: string
  icon: ComponentType<{ size?: number }>
}

/*
 * 搜索不在这里。
 *
 * 它曾经是第四个入口，但同一个窗口里还有一个常驻搜索框：两个入口通向同一件事，
 * 看上去就像有两个搜索栏。参考的三个播放器里，搜索都是「动作」而不是「目的地」——
 * 唯一的搜索框在标题栏，回车就把结果页打开。
 *
 * 所以这里只剩三项，搜索页仍然存在（它是结果页，有自己的来源标签页），只是不再
 * 占一个一级位置。
 */
const PRIMARY: PrimaryItem[] = [
  { group: 'discover', view: 'discover', label: '主页', icon: Compass },
  { group: 'library', view: 'library', label: '音乐库', icon: Library },
  { group: 'collection', view: 'collection', label: '收藏', icon: Heart },
  { group: 'settings', view: 'settings', label: '设置', icon: Settings }
]

/** 音乐库的栏目，与 LibraryView 的标签页一一对应。 */
const LIBRARY_TABS = [
  { tab: 'songs', label: '歌曲' },
  { tab: 'albums', label: '专辑' },
  { tab: 'artists', label: '艺术家' },
  { tab: 'folders', label: '文件夹' }
]

export function Rail({ route, onNavigate, collapsed, onToggleCollapsed, profileLabel, onOpenProfile }: RailProps) {
  const view = route.view
  const group = navGroupOf(view)

  /*
   * 侧栏底部这一行的头像跟设置页档案卡必须是同一张：先看档案自己设的头像，
   * 没设过就用该档案绑定的在线账号头像（网易云那种彩色头像是账号最有辨识度的部分），
   * 都没有才回落到档案名首字。这样同一个档案在两个位置看起来是同一个人。
   */
  const accounts = useAccounts((state) => state.accounts)
  const activeId = useAccounts((state) => state.activeId)
  const bindings = useOnlineBindings(accounts)
  const active = accounts.find((account) => account.id === activeId) ?? null
  const boundAvatar = activeId ? (bindings[activeId]?.avatarUrl ?? null) : null
  // 头像只显示 20px，按 96px 取就够；原图往往是几百 KB 的方形大图。
  const avatar = active?.avatar ?? (boundAvatar ? remoteImageUrl(sizedImage(boundAvatar, 96)) : null)

  // 旁边这一行本来就写着档案名，头像里再放一次首字只会读成「我 我」。
  const fallbackAvatar = <User size={17} />

  // 歌单挂在收藏下面，数组引用来自 store，稳定；这里只读不派生。
  const playlists = usePlaylists((state) => state.playlists)
  const likedCount = useFavorites((state) => state.liked.length)
  const libraryTab = view === 'library' ? (route.tab ?? 'songs') : null
  const collectionTab = view === 'collection' ? (route.tab ?? 'liked') : null

  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail__scroll">
        <div className="rail__group rail__group--primary">
          {PRIMARY.map((item) => {
            const active = group === item.group
            return (
              <div key={item.group} className="rail__section">
                <button
                  className={`nav-item${active ? ' is-active' : ''}`}
                  onClick={() => onNavigate({ view: item.view })}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon size={17} />
                  <span className="nav-item__label">{item.label}</span>
                </button>

                {item.group === 'library' ? (
                  <div className="rail__sub">
                    {LIBRARY_TABS.map((sub) => {
                      const current = libraryTab === sub.tab
                      return (
                        <button
                          key={sub.tab}
                          className={`nav-item nav-item--sub${current ? ' is-active' : ''}`}
                          onClick={() => onNavigate({ view: 'library', tab: sub.tab })}
                          aria-current={current ? 'page' : undefined}
                        >
                          <span className="nav-item__dot" />
                          <span className="nav-item__label">{sub.label}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                {item.group === 'collection' ? (
                  <div className="rail__sub">
                    <button
                      className={`nav-item nav-item--sub${collectionTab === 'liked' ? ' is-active' : ''}`}
                      onClick={() => onNavigate({ view: 'collection', tab: 'liked' })}
                      aria-current={collectionTab === 'liked' ? 'page' : undefined}
                    >
                      <span className="nav-item__dot" />
                      <span className="nav-item__label">我喜欢的歌曲</span>
                      {likedCount > 0 ? <span className="nav-item__count">{likedCount}</span> : null}
                    </button>
                    <button
                      className={`nav-item nav-item--sub${collectionTab === 'playlists' || view === 'playlists' ? ' is-active' : ''}`}
                      onClick={() => onNavigate({ view: 'collection', tab: 'playlists' })}
                      aria-current={collectionTab === 'playlists' ? 'page' : undefined}
                    >
                      <span className="nav-item__dot" />
                      <span className="nav-item__label">我的歌单</span>
                      {playlists.length > 0 ? (
                        <span className="nav-item__count">{playlists.length}</span>
                      ) : null}
                    </button>
                    {playlists.map((playlist) => {
                      const current = route.playlistId === playlist.id
                      return (
                        <button
                          key={playlist.id}
                          className={`nav-item nav-item--sub nav-item--sub2${current ? ' is-active' : ''}`}
                          onClick={() => onNavigate({ view: 'playlists', playlistId: playlist.id })}
                          title={playlist.name}
                          aria-current={current ? 'page' : undefined}
                        >
                          <span className="nav-item__dot" />
                          <span className="nav-item__label">{playlist.name}</span>
                          <span className="nav-item__count">{playlist.trackIds.length}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="rail-toggle">
        {/* 档案是设置里的第一个分区；这里只留一个「当前是谁」的指示，
            点它去设置。放在导航里会让人以为它是一个独立的目的地。 */}
        <button
          className="nav-item rail__profile"
          onClick={onOpenProfile}
          title={profileLabel ? `当前档案：${profileLabel}` : '选择档案'}
        >
          <span className="rail__avatar">
            {avatar ? (
              <Artwork src={avatar} fallback={fallbackAvatar} />
            ) : (
              fallbackAvatar
            )}
          </span>
          <span className="nav-item__label">{profileLabel ?? '未选择档案'}</span>
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
