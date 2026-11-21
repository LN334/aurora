import { useAccounts } from '../features/accounts/store'
import { useOnlineBindings } from '../features/accounts/bindings'
import { useUpdate } from '../features/updates/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { Artwork } from '../ui/Artwork'
import { Settings, Sidebar, User } from '../ui/icons'

/**
 * 顶栏右端那三颗：设置、当前档案、收起侧栏。
 *
 * 它们原来长在左栏底部（.rail__foot）。播放条改成贴边之后，那一块正好被压住；
 * 搬到顶栏右侧，左栏底部就空出来了，也不用再为「底栏多高」去算左栏的内边距。
 *
 * 头像的算法与「我」页的档案卡必须一致：先看档案自己设的，再回落到绑定的在线
 * 账号头像，都没有就用档案名首字。这段逻辑原来是 Rail 里的，现在搬到这里，
 * 左栏不再关心账号。
 */
interface TitleBarActsProps {
  collapsed: boolean
  profileLabel: string | null
  settingsActive: boolean
  profileActive: boolean
  onOpenSettings: () => void
  onOpenProfile: () => void
  onToggleCollapsed: () => void
}

export function TitleBarActs({
  collapsed,
  profileLabel,
  settingsActive,
  profileActive,
  onOpenSettings,
  onOpenProfile,
  onToggleCollapsed
}: TitleBarActsProps) {
  const updateReady = useUpdate((state) => state.result?.state === 'available' && !state.noted)
  const accounts = useAccounts((state) => state.accounts)
  const activeId = useAccounts((state) => state.activeId)
  const bindings = useOnlineBindings(accounts)
  const active = accounts.find((account) => account.id === activeId) ?? null
  const boundAvatar = activeId ? (bindings[activeId]?.avatarUrl ?? null) : null
  const avatar = active?.avatar ?? (boundAvatar ? remoteImageUrl(sizedImage(boundAvatar, 64), 64) : null)
  const fallback = <User size={14} />

  return (
    <div className="titlebar__acts">
      <button
        type="button"
        className={`titlebar__act${settingsActive ? ' is-active' : ''}`}
        onClick={onOpenSettings}
        title={updateReady ? '设置 · 有新版本' : '设置'}
        aria-label="设置"
        aria-current={settingsActive ? 'page' : undefined}
      >
        <Settings size={15} />
        {updateReady ? <span className="titlebar__act-dot" aria-hidden="true" /> : null}
      </button>

      <button
        type="button"
        className={`titlebar__act titlebar__act--me${profileActive ? ' is-active' : ''}`}
        onClick={onOpenProfile}
        title={profileLabel ? `当前档案：${profileLabel}` : '我'}
        aria-label={profileLabel ?? '我'}
        aria-current={profileActive ? 'page' : undefined}
      >
        {avatar ? <Artwork src={avatar} fallback={fallback} /> : fallback}
      </button>

      <button
        type="button"
        className="titlebar__act"
        onClick={onToggleCollapsed}
        title={collapsed ? '展开侧栏' : '收起侧栏'}
        aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
      >
        <Sidebar size={15} />
      </button>
    </div>
  )
}
