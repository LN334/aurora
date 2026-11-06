import type { ComponentType } from 'react'
import { navGroupOf, type NavGroup } from './routing'
import type { ViewId } from '../types'
import { useAccounts } from '../features/accounts/store'
import { useOnlineBindings } from '../features/accounts/bindings'
import { remoteImageUrl } from '../features/player/urls'
import { Artwork } from '../ui/Artwork'
import { Compass, Library, Settings, Sidebar, User } from '../ui/icons'

/**
 * The rail: four destinations, one per intent.
 *
 * 以前这里按平台和媒体类型分组：网易云一组（含每日推荐、红心、云盘、歌单）、
 * QQ 一组、歌单一组、本地音乐四项、设置三项。平台数和本地分类数都在长，而这个
 * 栏位不区分「你要去哪」和「东西从哪来」——于是本地音乐看起来像一个和网易云
 * 平级的应用，设置被切成三页。
 *
 * 现在一级只有三项：发现（有什么可听）、音乐库（我的东西，按来源切）、设置。
 * 平台与本地文件都退到「音乐库」里做来源标签页；搜索是标题栏那一个搜索框的动作，
 * 不占一级；详情页（专辑/艺术家/歌单）在路由里，但不在导航里——它们是从某一层
 * 进去的，靠返回键回来。
 */

interface RailProps {
  view: ViewId
  onView: (view: ViewId) => void
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
  { group: 'discover', view: 'discover', label: '发现', icon: Compass },
  { group: 'library', view: 'library', label: '音乐库', icon: Library },
  { group: 'settings', view: 'settings', label: '设置', icon: Settings }
]

export function Rail({ view, onView, collapsed, onToggleCollapsed, profileLabel, onOpenProfile }: RailProps) {
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
  const avatar = active?.avatar ?? (boundAvatar ? remoteImageUrl(boundAvatar) : null)

  const fallbackAvatar = active ? (
    <span className="rail__avatar-letter">{active.label.slice(0, 1)}</span>
  ) : (
    <User size={17} />
  )

  return (
    <nav className="rail" aria-label="主导航">
      <div className="rail__scroll">
        <div className="rail__group rail__group--primary">
          {PRIMARY.map((item) => {
            const active = group === item.group
            return (
              <button
                key={item.group}
                className={`nav-item${active ? ' is-active' : ''}`}
                onClick={() => onView(item.view)}
                aria-current={active ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
              >
                <item.icon size={17} />
                <span className="nav-item__label">{item.label}</span>
              </button>
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
