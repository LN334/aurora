import { useCallback, useEffect, useState } from 'react'
import { bridge, isNative } from '../../../bridge'
import { useAccounts } from '../../../features/accounts/store'
import { useRoots } from '../../../features/library/roots'
import { runScan } from '../../../features/library/scan'
import { useAvailableProviders } from '../../../features/online/hooks'
import { useOnlineStore } from '../../../features/online/store'
import type { OnlineMusicProvider } from '../../../features/online/types'
import { Plus, Trash } from '../../../ui/icons'
import { AccountsView } from '../../AccountsView'
import { Row, Rows, Sub } from '../parts'
import { openPlatformLogin } from './PlatformSignIn'

/**
 * 01 账号与平台。
 *
 * 这一块以前是三个独立的导航项：档案页（本地档案 + 每档案绑定的网易云账号）、
 * 音源页（能播什么 + 本地文件夹）、设置页里零散的在线开关。它们其实是同一个问题
 * ——「谁在用、能用哪些来源」——所以合并成一个分区，按「档案 → 平台 → 文件夹」
 * 的顺序排：先是谁，再是能用什么。
 *
 * 档案列表直接复用 AccountsView（它的受控 props 与本页需要的完全一致），不复制一份
 * 增删改与绑定逻辑；这里的职责只是把 store 的动作接上去，并在解绑后让它重新读一次绑定。
 */
export function AccountPane() {
  const accounts = useAccounts((state) => state.accounts)
  const activeId = useAccounts((state) => state.activeId)

  /*
   * AccountsView 只在打开时问一次「每个档案绑的是谁」，解绑不会触发它自己刷新。
   * 换一个 key 重挂比往它的内部塞订阅更小：它没有其它要保留的本地状态，
   * 而重挂一次也只是几个 IPC 读。
   */
  const [bindingKey, setBindingKey] = useState(0)

  const { roots, add, remove, busy } = useRoots()
  const [folderError, setFolderError] = useState<string | null>(null)

  const addFolders = useCallback(async () => {
    try {
      const next = await add()
      setFolderError(null)
      // 加进来就要索引：只把路径写进设置而曲库不变，读起来像「按钮没反应」。
      if (isNative && next.length > 0) await runScan()
    } catch (problem) {
      setFolderError(
        `加入文件夹失败：${problem instanceof Error ? problem.message : String(problem)}`
      )
    }
  }, [add])

  const unbind = useCallback((id: string) => {
    void bridge.netease.logoutProfile(id)
    // 当前档案的在线会话变了，共享的在线状态机要重新问一次主进程。
    if (useAccounts.getState().activeId === id) {
      void useOnlineStore('netease').getState().init().catch(() => {})
    }
    setBindingKey((key) => key + 1)
  }, [])

  return (
    <>
      <Sub title="本地档案">
        <div className="set-accounts">
          <AccountsView
            key={bindingKey}
            accounts={accounts}
            activeId={activeId}
            onCreate={(label) => useAccounts.getState().create(label)}
            onActivate={(id) => useAccounts.getState().activate(id)}
            onRename={(id, label) => useAccounts.getState().rename(id, label)}
            onRemove={(id) => useAccounts.getState().remove(id)}
            onUnbindOnline={unbind}
            onSetAvatar={(id, avatar) => useAccounts.getState().setAvatar(id, avatar)}
          />
        </div>
      </Sub>

      <Sub title="在线平台">
        <OnlinePlatformRows />
      </Sub>

      <Sub
        title="本地音乐文件夹"
        hint={roots.length > 0 ? `${roots.length} 个文件夹` : undefined}
      >
        {folderError ? <p className="settings__error">{folderError}</p> : null}
        {roots.length === 0 ? (
          <p className="set-empty">还没有加入文件夹。</p>
        ) : (
          <Rows>
            {roots.map((root) => (
              <Row key={root} label={folderName(root)} hint={root} title={root}>
                <button
                  className="icon-btn"
                  disabled={busy}
                  title={`移出曲库：${root}`}
                  aria-label={`移出曲库：${root}`}
                  onClick={() => void remove(root)}
                >
                  <Trash size={15} />
                </button>
              </Row>
            ))}
          </Rows>
        )}
        <div className="set-actions">
          <button className="btn" disabled={busy} onClick={() => void addFolders()}>
            <Plus size={15} />
            添加文件夹
          </button>
        </div>
      </Sub>
    </>
  )
}

/** 一行一个在线平台：名称、登录状态、登录或退出。 */
function OnlinePlatformRows() {
  const providers = useAvailableProviders()

  if (providers.length === 0) {
    return <p className="set-empty">这一版没有可用的在线平台。</p>
  }

  return (
    <Rows>
      {providers.map((provider) => (
        <OnlinePlatformRow key={provider.id} provider={provider} />
      ))}
    </Rows>
  )
}

function OnlinePlatformRow({ provider }: { provider: OnlineMusicProvider }) {
  const store = useOnlineStore(provider.id)
  const account = store((state) => state.account)
  const ready = store((state) => state.ready)
  const blocked = store((state) => state.backendBlocked)
  const detail = store((state) => state.statusDetail)
  const init = store((state) => state.init)
  const logout = store((state) => state.logout)

  useEffect(() => {
    /*
     * 设置页可能比平台页面先打开，而共享 store 的账号只有在 init 之后才从主进程读回来。
     * 不先问一次的话，已登录的账号会在这里显示成「未登录」——那是最容易让人以为登录丢了。
     */
    void init().catch(() => {})
  }, [init])

  const hint = account
    ? `已登录：${account.nickname}${account.vip ? ' · 会员' : ''}${
        account.level ? ` · Lv.${account.level}` : ''
      }`
    : blocked
      ? (detail ?? `${provider.displayName} 的后端现在连不上。`)
      : ready
        ? undefined
        : '正在确认登录状态…'

  return (
    <Row label={provider.displayName} hint={hint}>
      <span className={`set-state${account ? ' set-state--on' : ''}`}>
        {account ? '已登录' : '未登录'}
      </span>
      {account ? (
        <button className="btn btn--small" onClick={() => void logout()}>
          退出登录
        </button>
      ) : (
        <button className="btn btn--small" onClick={() => openPlatformLogin(provider.id)}>
          登录
        </button>
      )}
    </Row>
  )
}

/** 路径太长，行里只留最后一段；完整路径进 title 与 hint。 */
function folderName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? root
}
