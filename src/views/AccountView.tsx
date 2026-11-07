import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Route } from '../app/routing'
import { isNative } from '../bridge'
import { useOnlineBindings } from '../features/accounts/bindings'
import { useAccounts } from '../features/accounts/store'
import type { Account } from '../features/accounts/store'
import { useRoots } from '../features/library/roots'
import { runScan } from '../features/library/scan'
import { useAvailableProviders } from '../features/online/hooks'
import { platformView } from '../features/online/registry'
import { useOnlineStore } from '../features/online/store'
import type { OnlineMusicProvider } from '../features/online/types'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { Artwork } from '../ui/Artwork'
import { Check, Folder, Pencil, Plus, Trash } from '../ui/icons'
import { PlatformLoginDialogs, openPlatformLogin } from './settings/panes/PlatformSignIn'

/**
 * 账号页。
 *
 * 这一页回答两个问题：本机有哪几个档案、当前这个档案登录了哪些平台。
 * 本地文件夹也在这一页，因为「这个档案能播什么」由它决定。
 *
 * 版式按「谁 → 能登什么 → 能读什么」排成三个分区：抬头永远是一行
 * （编号 · 英文小标 · 中文名 · 发丝线 · 右侧操作），内容在下方铺满页面宽度。
 * 不复用设置页的两栏抬头：那套在宽窗口把抬头竖到左边一列，是为了让「label 左、
 * 控件右」的长表能一眼扫完；账号页每块都是横向卡片列表，套上之后反而又窄又空。
 *
 * 以前的版本把「档案列表」「每档案的绑定行」「新档案输入框」平铺在同一节里，
 * 同一个人名会出现两遍，输入框还长期裸露在页面中间；现在绑定关系并进档案行的
 * 第二行，新建改成抬头按钮按需展开。
 *
 * 页面标题由外壳打印（见 docs/ui-design.md「一页一个标题」），这里只负责内容。
 */
export function AccountView({ onNavigate }: { onNavigate(route: Route): void }) {
  return (
    <div className="account-page">
      <ProfilePart />
      <PlatformPart onNavigate={onNavigate} />
      <FolderPart />
      <PlatformLoginDialogs />
    </div>
  )
}

/**
 * 分区：抬头一行，内容在下。
 *
 * 编号与英文小标是设置页同一套分级语言（01 / LOCAL PROFILES / 本地档案），
 * 但这里把三者排成一行、用发丝线收住，不跟着窗口变宽就变两栏——
 * 账号页只有三块，抬头竖起来会剩一列空白。
 */
function Section({
  num,
  en,
  zh,
  actions,
  children
}: {
  num: string
  en: string
  zh: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="acct-sec" aria-label={num + ' ' + zh}>
      <header className="acct-sec__head">
        <span className="acct-sec__num">{num}</span>
        <span className="acct-sec__en">{en}</span>
        <h2 className="acct-sec__title">{zh}</h2>
        <span className="acct-sec__rule" aria-hidden="true" />
        {actions ? <div className="acct-sec__actions">{actions}</div> : null}
      </header>
      <div className="acct-sec__body">{children}</div>
    </section>
  )
}

/* =============================================================================
   01 本地档案
   ========================================================================== */

function ProfilePart() {
  const accounts = useAccounts((state) => state.accounts)
  const activeId = useAccounts((state) => state.activeId)
  const bindings = useOnlineBindings(accounts)

  const [editing, setEditing] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  /*
   * 每行一个 <label> 包着隐藏的 file input：点头像就是原生地「打开文件选择」，
   * 不需要在组件里记「这次点的是哪一行」，也不存在列表重建后 ref 指错行的可能。
   */
  const pickAvatar = async (id: string, file: File | undefined) => {
    if (!file) return
    const avatar = await toAvatarDataUrl(file)
    if (avatar) useAccounts.getState().setAvatar(id, avatar)
  }

  const beginRename = (account: Account) => {
    setEditing(account.id)
    setEditLabel(account.label)
  }

  const commitRename = (id: string) => {
    const label = editLabel.trim()
    if (label) useAccounts.getState().rename(id, label)
    setEditing(null)
  }

  const commitNew = () => {
    const label = draft.trim()
    if (!label) return
    useAccounts.getState().create(label)
    setDraft('')
    setCreating(false)
  }

  return (
    <Section
      num="01"
      en="LOCAL PROFILES"
      zh="本地档案"
      actions={
        <button className="btn btn--small" onClick={() => setCreating(true)} disabled={creating}>
          <Plus size={14} />
          新建档案
        </button>
      }
    >
      <ul className="acct-rows acct-rows--profiles">
        {accounts.map((account) => {
          const isActive = account.id === activeId
          const bound = bindings[account.id] ?? null
          return (
            <li className={`acct-row acct-row--profile${isActive ? ' is-active' : ''}`} key={account.id}>
              <label
                className={`acct-avatar${account.avatar || bound?.avatarUrl ? ' has-image' : ''}`}
                title="换头像"
              >
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    // 先清空 value，否则同一个文件连选两次不会再触发 change。
                    event.target.value = ''
                    void pickAvatar(account.id, file)
                  }}
                />
                {account.avatar ? (
                  <img src={account.avatar} alt="" />
                ) : bound?.avatarUrl ? (
                  <Artwork
                    src={remoteImageUrl(sizedImage(bound.avatarUrl, 128))}
                    fallback={account.label.slice(0, 1)}
                  />
                ) : (
                  account.label.slice(0, 1)
                )}
              </label>

              {editing === account.id ? (
                <input
                  className="acct-edit"
                  value={editLabel}
                  autoFocus
                  maxLength={40}
                  aria-label="档案名称"
                  onChange={(event) => setEditLabel(event.target.value)}
                  onBlur={() => commitRename(account.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <button
                  className="acct-name"
                  onClick={() => {
                    /*
                     * 只有一个档案时「点名字」不可能是切换（切到自己没意义），
                     * 那里最自然的动作是改名；多档案时才保持切换。
                     */
                    if (accounts.length === 1) beginRename(account)
                    else useAccounts.getState().activate(account.id)
                  }}
                  title={accounts.length === 1 ? '改档案名' : `切换到 ${account.label}`}
                >
                  <span className="acct-name__label">{account.label}</span>
                  <span className="acct-name__meta">{profileMeta(account, bound)}</span>
                </button>
              )}

              <div className="acct-row__actions">
                {isActive ? (
                  <span className="acct-badge">
                    <Check size={12} />
                    使用中
                  </span>
                ) : (
                  <button
                    className="btn btn--small"
                    onClick={() => useAccounts.getState().activate(account.id)}
                  >
                    切换
                  </button>
                )}
                <button
                  className="icon-btn"
                  onClick={() => beginRename(account)}
                  title="重命名"
                  aria-label={`重命名 ${account.label}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => useAccounts.getState().remove(account.id)}
                  disabled={accounts.length <= 1}
                  title={accounts.length <= 1 ? '至少要保留一个档案' : '删除这个档案'}
                  aria-label={`删除档案 ${account.label}`}
                >
                  <Trash size={15} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {/* 新建是读头按钮按需展开的一行，不做成常驻输入框。 */}
      {creating ? (
        <form
          className="acct-new"
          onSubmit={(event) => {
            event.preventDefault()
            commitNew()
          }}
        >
          <input
            value={draft}
            autoFocus
            maxLength={40}
            placeholder="给这个档案起个名字，比如「客厅」"
            aria-label="新档案的名字"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setCreating(false)
                setDraft('')
              }
            }}
          />
          <button className="btn btn--small" type="submit" disabled={!draft.trim()}>
            建立
          </button>
          <button
            className="btn btn--small"
            type="button"
            onClick={() => {
              setCreating(false)
              setDraft('')
            }}
          >
            取消
          </button>
        </form>
      ) : null}
    </Section>
  )
}

/* =============================================================================
   02 在线平台
   ========================================================================== */

function PlatformPart({ onNavigate }: { onNavigate(route: Route): void }) {
  const providers = useAvailableProviders()

  return (
    <Section num="02" en="ONLINE SERVICES" zh="在线平台">
      {providers.length === 0 ? (
        <p className="acct-empty">这一版没有可用的在线平台。</p>
      ) : (
        <div className="acct-platforms">
          {providers.map((provider) => (
            <PlatformRow key={provider.id} provider={provider} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </Section>
  )
}

function PlatformRow({
  provider,
  onNavigate
}: {
  provider: OnlineMusicProvider
  onNavigate(route: Route): void
}) {
  const store = useOnlineStore(provider.id)
  const account = store((state) => state.account)
  const ready = store((state) => state.ready)
  const blocked = store((state) => state.backendBlocked)
  const detail = store((state) => state.statusDetail)
  const init = store((state) => state.init)
  const logout = store((state) => state.logout)

  useEffect(() => {
    /*
     * 这一页可能比平台页面先打开，而共享 store 的账号只有在 init 之后才从主进程读回来。
     * 不先问一次的话，已登录的账号会在这里显示成「未登录」——那是最容易让人以为登录丢了。
     */
    void init().catch(() => {})
  }, [init])

  const shortName = provider.shortName ?? provider.displayName

  const meta = account
    ? `${account.nickname}${account.vip ? ' · 会员' : ''}${account.level ? ` · Lv.${account.level}` : ''}`
    : blocked
      ? (detail ?? `${provider.displayName} 的后端现在连不上。`)
      : ready
        ? '还没有登录。登录后这里会换成你的头像和昵称。'
        : '正在确认登录状态…'

  return (
    <div className="acct-row acct-row--platform">
      <span className="acct-mark" aria-hidden="true">
        {shortName.slice(0, 1)}
      </span>
      <div className="acct-platform">
        <div className="acct-platform__head">
          <span className="acct-platform__name">{provider.displayName}</span>
          <span className={`acct-state${account ? ' is-on' : ''}`}>
            {account ? '已登录' : '未登录'}
          </span>
        </div>
        <p className="acct-platform__meta">{meta}</p>
      </div>
      <div className="acct-row__actions">
        {/* 平台页本身也能看公开内容（搜索、未登录也能放的歌），所以「进入」不要求登录。 */}
        <button
          className="btn btn--small"
          onClick={() => onNavigate({ view: platformView(provider) })}
        >
          进入
        </button>
        {account ? (
          <button className="btn btn--small" onClick={() => void logout()}>
            退出登录
          </button>
        ) : (
          <button className="btn btn--small" onClick={() => openPlatformLogin(provider.id)}>
            登录
          </button>
        )}
      </div>
    </div>
  )
}

/* =============================================================================
   03 本地音乐文件夹
   ========================================================================== */

function FolderPart() {
  const { roots, add, remove, busy } = useRoots()
  const [error, setError] = useState<string | null>(null)

  const addFolders = useCallback(async () => {
    try {
      const next = await add()
      setError(null)
      // 加进来就要索引：只把路径写进设置而曲库不变，读起来像「按钮没反应」。
      if (isNative && next.length > 0) await runScan()
    } catch (problem) {
      setError(`加入文件夹失败：${problem instanceof Error ? problem.message : String(problem)}`)
    }
  }, [add])

  return (
    <Section
      num="03"
      en="MUSIC FOLDERS"
      zh="音乐文件夹"
      actions={
        <>
          <span className="acct-count">{roots.length > 0 ? `${roots.length} 个` : '空'}</span>
          <button className="btn btn--small" disabled={busy} onClick={() => void addFolders()}>
            <Plus size={14} />
            添加文件夹
          </button>
        </>
      }
    >
      {error ? <p className="acct-error">{error}</p> : null}
      {roots.length === 0 ? (
        <p className="acct-empty">
          还没有加入文件夹。加入之后这里开始扫描，扫完的曲目出现在音乐库的「本机」里。
        </p>
      ) : (
        <div className="acct-rows">
          {roots.map((root) => (
            <div className="acct-row acct-row--folder" key={root}>
              <span className="acct-mark" aria-hidden="true">
                <Folder size={16} />
              </span>
              <div className="acct-platform">
                <div className="acct-platform__name">{folderName(root)}</div>
                <p className="acct-platform__meta" title={root}>
                  {root}
                </p>
              </div>
              <div className="acct-row__actions">
                <button
                  className="icon-btn"
                  disabled={busy}
                  title={`移出曲库：${root}`}
                  aria-label={`移出曲库：${root}`}
                  onClick={() => void remove(root)}
                >
                  <Trash size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

/* =============================================================================
   工具
   ========================================================================== */

/** 第二行：当前绑的不是谁，别把「本机档案」写成一句话。 */
function profileMeta(
  account: Account,
  bound: { nickname: string; vip?: boolean } | null
): string {
  if (bound) return `网易云音乐 · ${bound.nickname}${bound.vip ? ' · 会员' : ''}`
  return account.createdAt ? `创建于 ${formatDate(account.createdAt)}` : '本机档案'
}

/** 路径太长，行里只留最后一段；完整路径进 title。 */
function folderName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? root
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('zh-CN')
  } catch {
    return ''
  }
}

/**
 * 把用户选的图片裁成方形的 96×96 JPEG。
 *
 * 头像最后存在 localStorage 里（跟着档案走），原图动辄几 MB，不缩就没法存；
 * 96 足够 38px 的圆形显示，2 倍屏也不糊。
 */
async function toAvatarDataUrl(file: File): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = 96
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) return null
    const scale = Math.max(size / bitmap.width, size / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    // 不是图片、或是损坏的文件：当作没选，界面保持原样。
    return null
  }
}
