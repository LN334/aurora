import type { WallpaperEntry, WallpaperInfo } from '../../env'

/**
 * The `follow` sentinel means "whatever Wallpaper Engine has on the desktop".
 *
 * It is a string rather than `null` because it is persisted next to real project
 * ids: a stored `null` would be indistinguishable from "nothing chosen yet" on
 * the next launch.
 */
export const FOLLOW_SELECTION = 'follow'

/**
 * How opaque the wallpaper veil starts at.
 *
 * Half is the honest default: the shell's own dark surfaces are built to sit on
 * top of artwork, and a wallpaper that starts fully visible turns every label
 * into a contrast problem on the first launch.
 */
export const DEFAULT_STRENGTH = 0.5

/**
 * Keep the slider's value inside the range the CSS understands.
 *
 * The veil is one `calc()` over this number, so anything outside 0..1 either
 * produces a negative alpha (transparent shell) or hides the wallpaper entirely.
 */
export function clampStrength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_STRENGTH
  return Math.min(1, Math.max(0, value))
}

/** `off` is the only value that disables it; absent or unreadable means enabled. */
export function parseEnabled(raw: string | null): boolean {
  return raw !== 'off'
}

/** Stored strength, falling back to the default when the value is not a number in range. */
export function parseStrength(raw: string | null): number {
  if (raw === null) return DEFAULT_STRENGTH
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 1) return DEFAULT_STRENGTH
  return value
}

export interface WallpaperChoice {
  enabled: boolean
  selection: string
  info: WallpaperInfo | null
  list: WallpaperEntry[]
}

/**
 * Which entry should currently be painted, or `null` for "no wallpaper".
 *
 * A pinned choice wins over `follow` so the user can keep one wallpaper while
 * Wallpaper Engine shuffles its own; it only falls back to follow when the pinned
 * project disappeared from the library (unsubscribed, deleted, drive unplugged).
 */
export function chooseEntry(choice: WallpaperChoice): WallpaperEntry | null {
  if (!choice.enabled) return null

  if (choice.selection !== FOLLOW_SELECTION) {
    const pinned = choice.list.find((entry) => entry.id === choice.selection)
    if (pinned) return pinned
  }

  if (!choice.info?.found) return null

  return choice.list.find((entry) => entry.current) ?? null
}
