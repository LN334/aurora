import { useState } from 'react'
import { providerOf } from '../features/accounts/providers'
import type { Account } from '../features/accounts/store'
import { useOnlineBindings } from '../features/accounts/bindings'
import { Check, Pencil, Plus, Trash } from '../ui/icons'
import { Artwork } from '../ui/Artwork'
import { remoteImageUrl } from '../features/player/urls'

interface AccountsViewProps {
  accounts: Account[]
  activeId: string | null
  onCreate(label: string): void
  onActivate(id: string): void
  onRename(id: string, label: string): void
  onRemove(id: string): void
  /** Unbinds the online account from a profile. */
  onUnbindOnline(id: string): void
  /** 换档案头像；null 表示用回在线头像或首字。 */
  onSetAvatar(id: string, avatar: string | null): void
}


/**
 * 把用户选的图片裁成方形的 96×96 JPEG。
 *
 * 头像最后存在 localStorage 里（跟着档案走），原图动辄几 MB，不缩就没法存；
 * 96 足够 26–40px 的圆形显示，2 倍屏也不糊。
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

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('zh-CN')
  } catch {
    return ''
  }
}

/**
 * Local profiles.
 *
 * This screen used to also list the online services that are not integrated,
 * each tagged "planned". That was a mistake: a settings page is not a roadmap,
 * and six rows of things that do not exist read as six broken promises. Anything
 * that is not implemented is now simply absent from the interface - the reasons
 * and the extension points live in the README, where someone who wants to build
 * on this can find them.
 */
export function AccountsView({
  accounts,
  activeId,
  onCreate,
  onActivate,
  onRename,
  onRemove,
  onUnbindOnline,
  onSetAvatar
}: AccountsViewProps) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const bindings = useOnlineBindings(accounts)

  /*
   * 每行一个 <label> 包着隐藏的 file input：点头像就是原生地「打开文件选择」，
   * 不需要在组件里记「这次点的是哪一行」，也不存在列表重建后 ref 指错行的可能。
   */
  const pickAvatar = async (id: string, file: File | undefined) => {
    if (!file) return
    const avatar = await toAvatarDataUrl(file)
    if (avatar) onSetAvatar(id, avatar)
  }

  const commitNew = () => {
    const label = draft.trim()
    if (!label) return
    onCreate(label)
    setDraft('')
  }

  const commitRename = (id: string) => {
    const label = editLabel.trim()
    if (label) onRename(id, label)
    setEditing(null)
  }

  return (
    <div className="accounts">
      <section className="accounts__group">
        <ul className="profile-rows">
          {accounts.map((account) => {
            const isActive = account.id === activeId
            const bound = bindings[account.id] ?? null
            return (
              <li className={`profile-row${isActive ? ' is-active' : ''}`} key={account.id}>
                <label
                  className={`profile-row__avatar${account.avatar || bound?.avatarUrl ? ' has-image' : ''}`}
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
                      src={remoteImageUrl(bound.avatarUrl)}
                      fallback={account.label.slice(0, 1)}
                    />
                  ) : (
                    account.label.slice(0, 1)
                  )}
                </label>

                {editing === account.id ? (
                  <input
                    className="profile-row__edit"
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
                    className="profile-row__name"
                    onClick={() => {
                      /*
                       * 只有一个档案时「点名字」不可能是切换（切到自己没意义），
                       * 那里最自然的动作是改名；多档案时才保持切换。
                       */
                      if (accounts.length === 1) {
                        setEditing(account.id)
                        setEditLabel(account.label)
                      } else {
                        onActivate(account.id)
                      }
                    }}
                    title={
                      accounts.length === 1
                        ? '改档案名'
                        : `切换到 ${account.label}`
                    }
                  >
                    <span className="profile-row__label">{account.label}</span>
                    <span className="profile-row__meta">
                      {bound
                        ? `${bound.nickname}${bound.vip ? ' · 会员' : ''}`
                        : providerOf(account.provider).name}
                      {account.createdAt && !bound
                        ? `，创建于 ${formatDate(account.createdAt)}`
                        : ''}
                    </span>
                  </button>
                )}

                {isActive ? (
                  <span className="profile-row__badge">
                    <Check size={13} /> 使用中
                  </span>
                ) : (
                  <button className="btn btn--small" onClick={() => onActivate(account.id)}>
                    切换
                  </button>
                )}

                <button
                  className="icon-btn"
                  onClick={() => {
                    setEditing(account.id)
                    setEditLabel(account.label)
                  }}
                  title="重命名"
                  aria-label={`重命名 ${account.label}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn profile-row__remove"
                  onClick={() => onRemove(account.id)}
                  disabled={accounts.length <= 1}
                  title={accounts.length <= 1 ? '至少要保留一个档案' : '删除这个档案'}
                  aria-label={`删除档案 ${account.label}`}
                >
                  <Trash size={15} />
                </button>
              </li>
            )
          })}
        </ul>

        {/*
          The online account, per profile.
          This used to be invisible from here: the profiles screen listed local
          profiles and said nothing about the machine-wide Netease session, which
          is why the two looked like unrelated logins. Each profile now shows
          which account it is signed in as, and can be unbound on its own.
        */}
        <section className="accounts__group">
          {/*
            * 这里原本有「网易云账号」小标题和一段解释「每个档案各自绑定一个…」。
            * 删掉的理由和平台页那两段一样：绑定行自己就写着「谁 · 未登录 / 昵称」，
            * 标题与规则说明只是在重复用户已经从行里读到的东西。
            */}
          <ul className="binding-rows">
            {accounts.map((account) => {
              const bound = bindings[account.id]
              return (
                <li className="binding-row" key={account.id}>
                  {/*
                    * 只有一个档案时，行首再写一遍档案名就是「我 / 我」两行叠着——
                    * 上面那张档案卡已经说了是谁。这里改成平台名，读起来是
                    * 「网易云音乐 · 未登录」，而不是把档案名重复两次。
                    */}
                  <span className="binding-row__profile">
                    {accounts.length > 1 ? account.label : '网易云音乐'}
                  </span>
                  {bound ? (
                    <>
                      <span className="binding-row__account">
                        {bound.nickname}
                        {bound.vip ? ' · 会员' : ''}
                      </span>
                      <button className="btn btn--small" onClick={() => onUnbindOnline(account.id)}>
                        解除绑定
                      </button>
                    </>
                  ) : (
                    <span className="binding-row__empty">
                      {account.id === activeId ? '未登录' : '未绑定'}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <form
          className="accounts__new"
          onSubmit={(event) => {
            event.preventDefault()
            commitNew()
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="新档案的名字，比如「客厅」"
            aria-label="新档案的名字"
            maxLength={40}
          />
          <button className="btn" type="submit" disabled={!draft.trim()}>
            <Plus size={15} />
            新建档案
          </button>
        </form>
      </section>
    </div>
  )
}
