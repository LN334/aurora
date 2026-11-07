import { create } from 'zustand'
import { bridge } from '../../bridge'
import type { WallpaperEntry, WallpaperInfo } from '../../env'
import {
  FOLLOW_SELECTION,
  clampStrength,
  parseEnabled,
  parseQuality,
  parseStrength
} from './pure'
import type { PropertyValue, WallpaperQuality } from './pure'

/**
 * Which wallpaper the shell paints behind itself.
 *
 * Stored in `localStorage` rather than in the main process settings file on
 * purpose: this is a per-window presentation choice, the main process never has
 * to agree with it, and the values have to be readable synchronously during the
 * first render - an IPC round trip would paint the shell once without a backdrop
 * and then repaint it.
 */
const ENABLED_KEY = 'aurora.backdrop.wallpaper'
const SELECTION_KEY = 'aurora.backdrop.wallpaper.id'
const STRENGTH_KEY = 'aurora.backdrop.wallpaper.strength'
const QUALITY_KEY = 'aurora.backdrop.quality'
/**
 * 壁纸工程自带的可调项按壁纸 id 分开记：每张壁纸都有自己的一套属性名，
 * 混在一起既会互相覆盖，也会在换壁纸时把不相干的键传给着色器。
 *
 * 形状是 `{ [entryId]: { [propertyName]: value } }`。
 */
const PROPS_KEY = 'aurora.backdrop.props'

/**
 * `localStorage` can throw (disabled storage, quota, hardened profiles). A
 * wallpaper preference is never worth crashing the shell over, so every access
 * degrades to the default.
 */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preference not persisted; the in-memory state still reflects the choice.
  }
}

/** 从 localStorage 读出按壁纸分组的属性覆盖值；坏数据当成没有。 */
function readProps(): Record<string, Record<string, PropertyValue>> {
  const raw = read(PROPS_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, Record<string, PropertyValue>> = {}
    for (const [entryId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const props: Record<string, PropertyValue> = {}
      for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          props[name] = item
        }
      }
      if (Object.keys(props).length > 0) out[entryId] = props
    }
    return out
  } catch {
    return {}
  }
}

interface WallpaperState {
  enabled: boolean
  /** A project id, or `FOLLOW_SELECTION` to mirror Wallpaper Engine's own choice. */
  selection: string
  /** 0..1 - how visible the wallpaper is against the shell's scrim. */
  strength: number
  /** 场景壁纸的帧率与光栅化分辨率档位。 */
  quality: WallpaperQuality
  info: WallpaperInfo | null
  list: WallpaperEntry[]
  loading: boolean
  /** 用户改过的壁纸自带属性，按壁纸 id 分组；没改过的项不在里面。 */
  values: Record<string, Record<string, PropertyValue>>

  setEnabled(next: boolean): void
  setSelection(id: string): void
  setStrength(value: number): void
  setQuality(next: WallpaperQuality): void
  /** Re-probe the main process; `force` bypasses its 30 second scan cache. */
  refresh(force?: boolean): void
  /** 改一项壁纸属性：立刻生效并落盘，下次打开同一张壁纸还是这个值。 */
  setProperty(entryId: string, name: string, value: PropertyValue): void
  /** 把这张壁纸的属性全部恢复成工程默认值。 */
  resetProperties(entryId: string): void
}

export const useWallpaper = create<WallpaperState>((set, get) => ({
  enabled: parseEnabled(read(ENABLED_KEY)),
  selection: read(SELECTION_KEY) ?? FOLLOW_SELECTION,
  strength: parseStrength(read(STRENGTH_KEY)),
  quality: parseQuality(read(QUALITY_KEY)),
  info: null,
  list: [],
  loading: false,
  values: readProps(),

  setEnabled(next) {
    write(ENABLED_KEY, next ? 'on' : 'off')
    set({ enabled: next })
    // Turning it on is the moment the user expects to see a wallpaper, so the
    // first probe has to ignore a cache filled while the feature was off.
    if (next) get().refresh(true)
  },

  setSelection(id) {
    write(SELECTION_KEY, id)
    set({ selection: id })
  },

  setStrength(value) {
    const next = clampStrength(value)
    write(STRENGTH_KEY, String(next))
    set({ strength: next })
  },

  setQuality(next) {
    write(QUALITY_KEY, next)
    set({ quality: next })
  },

  refresh(force = false) {
    const api = bridge.wallpaper
    /*
     * Renderer and main process do not ship as one file: when a build reads a
     * preload script from an older install (or the browser preview), the bridge
     * exists but this method does not. That is "no wallpaper", not a crash on the
     * first frame after launch.
     */
    if (!api) {
      set({ info: null, list: [], loading: false })
      return
    }
    set({ loading: true })
    void Promise.all([api.info(force), api.list(force)])
      .then(([info, list]) => set({ info, list, loading: false }))
      .catch(() =>
        // No engine, no permission, unreadable config: the shell just has no
        // backdrop, which is the same state as "feature off".
        set({ info: null, list: [], loading: false })
      )
  },

  setProperty(entryId, name, value) {
    const values = {
      ...get().values,
      [entryId]: { ...(get().values[entryId] ?? {}), [name]: value }
    }
    write(PROPS_KEY, JSON.stringify(values))
    set({ values })
  },

  resetProperties(entryId) {
    if (!get().values[entryId]) return
    const values = { ...get().values }
    delete values[entryId]
    write(PROPS_KEY, JSON.stringify(values))
    set({ values })
  }
}))
