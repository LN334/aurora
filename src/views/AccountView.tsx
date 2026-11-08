import { useCallback, useEffect, useState } from 'react'
import type { Route } from '../app/routing'
import { isNative } from '../bridge'
import { useOnlineBindings } from '../features/accounts/bindings'
import { useAccounts } from '../features/accounts/store'
import type { Account } from '../features/accounts/store'
import { useRoots } from '../features/library/roots'
import { runScan } from '../features/library/scan'
import { useAvailableProviders } from '../features/online/hooks'
import { useOnlineStore } from '../features/online/store'
import type { OnlineMusicProvider } from '../features/online/types'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { Artwork } from '../ui/Artwork'
import { Check, Folder, Pencil, Plus, Trash } from '../ui/icons'
import { PlatformLoginDialogs, openPlatformLogin } from './settings/panes/PlatformSignIn'

/**
 * 账号页。
 *
 * 三块：当前档案（hero）→ 在线平台（四张平级卡）→ 音乐文件夹。
 * 所有平台的登录入口都收在这一页，不另开页面；平台只作为卡片并列，
 * 不按平台再分页。
 */
export function AccountView(_props: { onNavigate(route: Route): void }) {
  return (
    <div className="acct2-page">
      <ProfilePart />
      <PlatformPart />
      <FolderPart />
      <PlatformLoginDialogs />
    </div>
  )
}

/* =============================================================================
   01 当前档案
   ========================================================================== */

function ProfilePart() {
  const accounts = useAccounts((state) => state.accounts)
  const activeId = useAccounts((state) => state.activeId)
  const bindings = useOnlineBindings(accounts)

  const [editing, setEditing] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const active = (accounts.find((item) => item.id === activeId) ?? accounts[0]) as Account
  const bound = bindings[active.id] ?? null
  /**
   * 这一行原来只写网易云，看着像「这个档案就是网易云账号」。
   * 档案是本机的，平台只是挂在它下面的登录态，登了几家就都写出来。
   */
  const signedIn = [
    useOnlineStore('netease')().account ? '网易云音乐' : '',
    useOnlineStore('qq')().account ? 'QQ 音乐' : '',
    useOnlineStore('kugou')().account ? '酷狗音乐' : '',
    useOnlineStore('qishui')().account ? '汽水音乐' : ''
  ].filter(Boolean)

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
    <section className="acct2-hero" aria-label="本地档案">
      <label
        className={'acct2-avatar' + (active.avatar || bound?.avatarUrl ? ' has-image' : '')}
        title="换头像"
      >
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void pickAvatar(active.id, file)
          }}
        />
        {active.avatar ? (
          <img src={active.avatar} alt="" />
        ) : bound?.avatarUrl ? (
          <Artwork
            src={remoteImageUrl(sizedImage(bound.avatarUrl, 128), 128)}
            fallback={active.label.slice(0, 1)}
          />
        ) : (
          active.label.slice(0, 1)
        )}
      </label>

      <div className="acct2-ident">
        {editing === active.id ? (
          <input
            className="acct2-edit"
            value={editLabel}
            autoFocus
            maxLength={40}
            aria-label="档案名称"
            onChange={(event) => setEditLabel(event.target.value)}
            onBlur={() => commitRename(active.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') setEditing(null)
            }}
          />
        ) : (
          <button className="acct2-name" type="button" onClick={() => beginRename(active)} title="改档案名">
            {active.label}
            <Pencil size={13} />
          </button>
        )}
        <p className="acct2-meta">{heroMeta(active, bound, signedIn)}</p>
      </div>

      <div className="acct2-acts">
        <button className="btn btn--small" onClick={() => setCreating(true)} disabled={creating}>
          <Plus size={14} />
          新建档案
        </button>
      </div>

      {accounts.length > 1 ? (
        <div className="acct2-switch">
          {accounts.map((account) => {
            const on = account.id === activeId
            return (
              <button
                key={account.id}
                type="button"
                className={'acct2-chip' + (on ? ' is-on' : '')}
                onClick={() => {
                  if (on) beginRename(account)
                  else useAccounts.getState().activate(account.id)
                }}
                title={on ? '当前档案，点击改名' : '切换到 ' + account.label}
              >
                <i aria-hidden="true">{account.label.slice(0, 1)}</i>
                {account.label}
                {on ? <Check size={12} /> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {creating ? (
        <form
          className="acct2-new"
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
    </section>
  )
}
/* =============================================================================
   02 在线平台
   ========================================================================== */

function PlatformPart() {
  const providers = useAvailableProviders()

  return (
    <section className="acct2-block" aria-label="在线平台">
      <header className="acct2-head">
        <h3>在线平台</h3>
        <span className="acct2-head__note">登录后，歌单、收藏和推荐都跟着这个账号走</span>
      </header>
      {providers.length === 0 ? (
        <p className="acct2-empty">这一版没有可用的在线平台。</p>
      ) : (
        <div className="acct2-plats">
          {providers.map((provider) => (
            <PlatformCard key={provider.id} provider={provider} />
          ))}
        </div>
      )}
    </section>
  )
}

function PlatformCard({ provider }: { provider: OnlineMusicProvider }) {
  const store = useOnlineStore(provider.id)
  const account = store((state) => state.account)
  const ready = store((state) => state.ready)
  const blocked = store((state) => state.backendBlocked)
  const detail = store((state) => state.statusDetail)
  const init = store((state) => state.init)
  const logout = store((state) => state.logout)

  useEffect(() => {
    // 这一页常比平台页先打开；不先问一次，已登录也会显示成未登录。
    void init().catch(() => {})
  }, [init])

  const name = provider.shortName ?? provider.displayName
  const tags = capabilityTags(provider)

  const meta = account
    ? [account.vip ? '会员' : null, account.level ? 'Lv.' + account.level : null]
        .filter(Boolean)
        .join(' · ') || '已连接'
    : blocked
      ? (detail ?? '暂时连不上')
      : ready
        ? '还没有登录'
        : '正在确认登录状态…'

  return (
    <div className={'acct2-pcard' + (account ? ' is-on' : '')}>
      <div className="acct2-pcard__top">
        <span className={'acct2-dot acct2-dot--' + provider.id} aria-hidden="true" />
        <span className="acct2-pcard__name">{name}</span>
        <span className={'acct2-pill' + (account ? ' is-on' : '')}>
          {account ? '已登录' : ready ? '未登录' : '连接中'}
        </span>
      </div>

      <div className="acct2-who">{account ? account.nickname : '未登录'}</div>
      <p className="acct2-pmeta">{meta}</p>

      {tags.length > 0 ? (
        <div className="acct2-tags">
          {tags.map((tag) => (
            <span className="acct2-tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="acct2-pacts">
        {account ? (
          <button className="btn btn--small" onClick={() => void logout()}>
            退出登录
          </button>
        ) : (
          <button
            className="btn btn--small acct2-login"
            onClick={() => openPlatformLogin(provider.id)}
            disabled={!ready}
          >
            登录
          </button>
        )}
      </div>
    </div>
  )
}

/** 一张卡只说三件事，多了就成功能清单了。 */
function capabilityTags(provider: OnlineMusicProvider): string[] {
  const caps = provider.capabilities
  const out: string[] = []
  if (caps.search) out.push('搜索')
  if (caps.playlists) out.push('歌单')
  if (caps.likes) out.push('收藏')
  if (caps.recommendations) out.push('推荐')
  return out.slice(0, 4)
}

/* =============================================================================
   03 本地音乐文件夹
   ========================================================================== */

function FolderPart() {
  const profileId = useAccounts((state) => state.activeId)
  const { roots, add, remove, busy } = useRoots(profileId)
  const [error, setError] = useState<string | null>(null)

  const addFolders = useCallback(async () => {
    try {
      const next = await add()
      setError(null)
      // 加进来就要索引：只写路径而曲库不变，读起来像「按钮没反应」。
      if (isNative && next.length > 0) await runScan()
    } catch (problem) {
      setError('加入文件夹失败：' + (problem instanceof Error ? problem.message : String(problem)))
    }
  }, [add])

  return (
    <section className="acct2-block" aria-label="音乐文件夹">
      <header className="acct2-head">
        <h3>音乐文件夹</h3>
        <span className="acct2-head__note">
          {roots.length > 0 ? roots.length + ' 个' : '还没有加入'}
        </span>
        <div className="acct2-head__acts">
          <button className="btn btn--small" disabled={busy} onClick={() => void addFolders()}>
            <Plus size={14} />
            添加文件夹
          </button>
        </div>
      </header>

      {error ? <p className="acct2-error">{error}</p> : null}

      {roots.length === 0 ? (
        <p className="acct2-empty">还没有加入文件夹。加入之后会扫一遍，曲目出现在音乐库的「本机」里。</p>
      ) : (
        <div className="acct2-folders">
          {roots.map((root) => (
            <div className="acct2-folder" key={root}>
              <span className="acct2-folder__icon" aria-hidden="true">
                <Folder size={16} />
              </span>
              <div className="acct2-folder__text">
                <div className="acct2-folder__name">{folderName(root)}</div>
                <div className="acct2-folder__path" title={root}>
                  {root}
                </div>
              </div>
              <button
                className="icon-btn"
                disabled={busy}
                title={'移出曲库：' + root}
                aria-label={'移出曲库：' + root}
                onClick={() => void remove(root)}
              >
                <Trash size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* =============================================================================
   工具
   ========================================================================== */

function heroMeta(
  account: Account,
  bound: { nickname: string; vip?: boolean } | null,
  signedIn: string[]
): string {
  if (signedIn.length > 1) return signedIn.join(' · ') + ' 已登录'
  if (bound) return '网易云音乐 · ' + bound.nickname + (bound.vip ? ' · 会员' : '')
  if (signedIn.length === 1) return signedIn[0] + ' 已登录'
  return account.createdAt ? '创建于 ' + formatDate(account.createdAt) : '本机档案'
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
 * 把用户选的图片裁成方形 96×96 JPEG：头像存 localStorage，原图动辄几 MB。
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
    return null
  }
}