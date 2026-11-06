import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderId } from './providers'

/**
 * Accounts on this machine.
 *
 * `config` holds non-secret settings only (a server URL, a username). Anything
 * that is actually a credential belongs in the main process, encrypted with
 * Electron's safeStorage, and must never be written into renderer storage -
 * which for this app means localStorage and therefore a plain text file.
 */
export interface Account {
  id: string
  provider: ProviderId
  label: string
  config: Record<string, string>
  createdAt: number
  /**
   * 档案自己的头像，一张已经缩到 96×96 的 data URL。
   *
   * 为什么是 data URL 而不是文件路径：档案本身存在 localStorage 里（见下面的 persist），
   * 头像要是落到 userData 目录，就得在主进程再开一套「谁的头像」的映射，还要处理档案
   * 删除后的清理。96×96 的 JPEG 大约 4–8 KB，直接跟着档案走最省事，删档案也就一起没了。
   * 没设过这一项时留空，界面回落到在线账号的头像，再回落到档案名首字。
   */
  avatar?: string
}

interface AccountsState {
  accounts: Account[]
  activeId: string | null

  create(label: string, provider?: ProviderId, config?: Record<string, string>): Account
  rename(id: string, label: string): void
  remove(id: string): void
  activate(id: string): void
  /** 设成 null 就是「用回默认的在线头像或首字」。 */
  setAvatar(id: string, avatar: string | null): void
  /** Creates the first profile on a fresh install. Idempotent. */
  ensureDefault(): void
  active(): Account | null
}

function newId(): string {
  return `acc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
}

export const useAccounts = create<AccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],
      activeId: null,

      create(label, provider = 'local', config = {}) {
        const account: Account = {
          id: newId(),
          provider,
          label: label.trim() || '未命名档案',
          config,
          createdAt: Date.now()
        }
        set((state) => ({
          accounts: [...state.accounts, account],
          activeId: state.activeId ?? account.id
        }))
        return account
      },

      rename(id, label) {
        const clean = label.trim()
        if (!clean) return
        set((state) => ({
          accounts: state.accounts.map((a) => (a.id === id ? { ...a, label: clean } : a))
        }))
      },

      remove(id) {
        set((state) => {
          const accounts = state.accounts.filter((a) => a.id !== id)
          // Removing the active profile must not leave a dangling activeId.
          const activeId = state.activeId === id ? (accounts[0]?.id ?? null) : state.activeId
          return { accounts, activeId }
        })
      },

      activate(id) {
        if (!get().accounts.some((a) => a.id === id)) return
        set({ activeId: id })
      },

      setAvatar(id, avatar) {
        set((state) => ({
          accounts: state.accounts.map((account) => {
            if (account.id !== id) return account
            if (!avatar) {
              // 删掉这一项而不是留空串：序列化后文件里不该多一个空字段。
              const { avatar: _drop, ...rest } = account
              return rest
            }
            return { ...account, avatar }
          })
        }))
      },

      ensureDefault() {
        const { accounts } = get()
        if (accounts.length > 0) {
          if (!get().activeId) set({ activeId: accounts[0].id })
          return
        }
        const account: Account = {
          id: newId(),
          provider: 'local',
          label: '我',
          config: {},
          createdAt: Date.now()
        }
        set({ accounts: [account], activeId: account.id })
      },

      active() {
        const { accounts, activeId } = get()
        return accounts.find((a) => a.id === activeId) ?? null
      }
    }),
    {
      name: 'aurora.accounts',
      version: 1
    }
  )
)
