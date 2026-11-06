import { create } from 'zustand'
import { bridge } from '../../bridge'
import type { WallpaperEntry, WallpaperInfo } from '../../env'
import { FOLLOW_SELECTION, clampStrength, parseEnabled, parseStrength } from './pure'

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

interface WallpaperState {
  enabled: boolean
  /** A project id, or `FOLLOW_SELECTION` to mirror Wallpaper Engine's own choice. */
  selection: string
  /** 0..1 - how visible the wallpaper is against the shell's scrim. */
  strength: number
  info: WallpaperInfo | null
  list: WallpaperEntry[]
  loading: boolean

  setEnabled(next: boolean): void
  setSelection(id: string): void
  setStrength(value: number): void
  /** Re-probe the main process; `force` bypasses its 30 second scan cache. */
  refresh(force?: boolean): void
}

export const useWallpaper = create<WallpaperState>((set, get) => ({
  enabled: parseEnabled(read(ENABLED_KEY)),
  selection: read(SELECTION_KEY) ?? FOLLOW_SELECTION,
  strength: parseStrength(read(STRENGTH_KEY)),
  info: null,
  list: [],
  loading: false,

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
  }
}))
