import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * 可改的键位。
 *
 * 从前键位写死在 useKeyboardShortcuts 里的一串 if——想换一个键就得改代码。
 * 这里把「有哪些动作」「默认按什么」「用户改成了什么」三件事分开：
 *
 * - `HOTKEYS` 是动作表（id / 名称 / 适用范围 / 默认组合），代码里只认 id；
 * - `useHotkeys` 只存「改过的那几条」，没改过的用默认值；
 * - 组合串统一用 `Mod+Alt+Code` 的形式（Code 是 KeyboardEvent.code，如 KeyK、
 *   Space、ArrowRight），这样 Shift 与符号键不会因为键盘布局而错位。
 *
 * 全局热键（窗口不在前台也能用）由主进程注册，它从同一份覆盖表读。
 */

type HotkeyScope = 'app' | 'global'

interface HotkeyDef {
  id: string
  /** 设置页显示的名字。 */
  label: string
  scope: HotkeyScope
  /** 默认组合；空串表示「不绑定」。 */
  def: string
}

/**
 * 动作表。
 *
 * `app` 只在窗口聚焦时生效（渲染层监听），`global` 由主进程注册、任何程序里都响应。
 * 两套分开列，因为它们注册的机制不同，混在一起会让「改完没生效」难以解释。
 */
export const HOTKEYS: HotkeyDef[] = [
  { id: 'search', label: '聚焦搜索框', scope: 'app', def: 'Mod+KeyK' },
  { id: 'play', label: '播放 / 暂停', scope: 'app', def: 'Space' },
  { id: 'next', label: '下一首', scope: 'app', def: 'Mod+ArrowRight' },
  { id: 'prev', label: '上一首', scope: 'app', def: 'Mod+ArrowLeft' },
  { id: 'seekForward', label: '快进 5 秒', scope: 'app', def: 'ArrowRight' },
  { id: 'seekBack', label: '快退 5 秒', scope: 'app', def: 'ArrowLeft' },
  { id: 'volumeUp', label: '音量加', scope: 'app', def: 'ArrowUp' },
  { id: 'volumeDown', label: '音量减', scope: 'app', def: 'ArrowDown' },
  { id: 'stage', label: '播放页（沉浸歌词）', scope: 'app', def: 'KeyL' },
  { id: 'eq', label: '调音台', scope: 'app', def: 'KeyE' },
  { id: 'roam', label: '漫游', scope: 'app', def: 'KeyR' },
  { id: 'fullscreen', label: '全屏', scope: 'app', def: 'F11' },

  { id: 'globalPlay', label: '播放 / 暂停（任何程序）', scope: 'global', def: 'Ctrl+Alt+Space' },
  { id: 'globalNext', label: '下一首（任何程序）', scope: 'global', def: 'Ctrl+Alt+ArrowRight' },
  { id: 'globalPrev', label: '上一首（任何程序）', scope: 'global', def: 'Ctrl+Alt+ArrowLeft' },
  { id: 'globalVolumeUp', label: '音量加（任何程序）', scope: 'global', def: 'Ctrl+Alt+ArrowUp' },
  { id: 'globalVolumeDown', label: '音量减（任何程序）', scope: 'global', def: 'Ctrl+Alt+ArrowDown' },
  { id: 'globalOverlay', label: '桌面歌词（任何程序）', scope: 'global', def: 'Ctrl+Alt+KeyL' },
  { id: 'globalLock', label: '锁定桌面歌词（任何程序）', scope: 'global', def: 'Ctrl+Alt+KeyK' }
]

export const HOTKEY_BY_ID = new Map(HOTKEYS.map((item) => [item.id, item]))

/** 把 KeyboardEvent 折成一个组合串。Mod 兼容 Ctrl 与 ⌘。 */
export function comboOf(event: {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Mod')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(event.code)
  return parts.join('+')
}

/** 组合串里的人话：KeyK → K，Mod → Ctrl，ArrowRight → →。 */
export function prettyCombo(combo: string): string[] {
  if (!combo) return ['未绑定']
  return combo.split('+').map((part) => {
    if (part === 'Mod') return 'Ctrl'
    if (part === 'Alt') return 'Alt'
    if (part === 'Shift') return 'Shift'
    if (part === 'Space') return 'Space'
    if (part.startsWith('Key')) return part.slice(3)
    if (part.startsWith('Digit')) return part.slice(5)
    if (part === 'ArrowRight') return '→'
    if (part === 'ArrowLeft') return '←'
    if (part === 'ArrowUp') return '↑'
    if (part === 'ArrowDown') return '↓'
    if (part === 'Escape') return 'Esc'
    return part
  })
}

interface HotkeyStore {
  /** 只存改过的：id → 组合串。空串表示用户把它取消了。 */
  overrides: Record<string, string>
  set(id: string, combo: string): void
  reset(id: string): void
  resetAll(): void
}

export const useHotkeys = create<HotkeyStore>()(
  persist(
    (set) => ({
      overrides: {},
      set: (id, combo) => set((state) => ({ overrides: { ...state.overrides, [id]: combo } })),
      reset: (id) =>
        set((state) => {
          const next = { ...state.overrides }
          delete next[id]
          return { overrides: next }
        }),
      resetAll: () => set({ overrides: {} })
    }),
    { name: 'aurora.hotkeys', version: 1 }
  )
)

/** 某个动作此刻生效的组合串。 */
export function comboFor(id: string): string {
  const overrides = useHotkeys.getState().overrides
  if (id in overrides) return overrides[id]
  return HOTKEY_BY_ID.get(id)?.def ?? ''
}

/** 同一 scope 里还有谁占着这个组合（不含自己）。 */
export function conflictFor(scope: HotkeyScope, combo: string, selfId: string): HotkeyDef | null {
  if (!combo) return null
  for (const item of HOTKEYS) {
    if (item.scope !== scope || item.id === selfId) continue
    if (comboFor(item.id) === combo) return item
  }
  return null
}
