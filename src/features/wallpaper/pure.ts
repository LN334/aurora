import type { WallpaperEntry, WallpaperInfo, WallpaperProperty } from '../../env'

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
/**
 * 传给场景引擎的一个属性值。
 *
 * 形状照抄 Wallpaper Engine：滑块是数字、开关是布尔，颜色是 "r g b" 三个
 * 0..1 的浮点数拼成的字符串，下拉是字符串。
 */
export type PropertyValue = boolean | number | string

/** 这些值本身不进渲染，只作为 UI 的输入；落到引擎前统一按类型收一次。 */
export function coercePropertyValue(
  property: WallpaperProperty,
  raw: unknown
): PropertyValue | null {
  if (property.type === 'slider') {
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(value)) return null
    const min = Number.isFinite(property.min) ? (property.min as number) : -Infinity
    const max = Number.isFinite(property.max) ? (property.max as number) : Infinity
    return Math.min(max, Math.max(min, value))
  }
  if (property.type === 'bool') {
    if (typeof raw === 'boolean') return raw
    return null
  }
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number') return String(raw)
  return null
}

/**
 * 把一项颜色属性转成 `<input type="color">` 认识的 `#rrggbb`。
 *
 * Wallpaper Engine 的颜色是线性 / sRGB 无所谓——作者在 WE 里看到的预览与这里
 * 的取色器只要都按 0..1 映射，眼睛看到的就是同一块色。
 */
export function colorToHex(value: unknown): string {
  const parts =
    typeof value === 'string'
      ? value
          .trim()
          .split(/\s+/)
          .map(Number)
      : []
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return '#ffffff'
  const channel = (part: number) =>
    Math.round(Math.min(1, Math.max(0, part)) * 255)
      .toString(16)
      .padStart(2, '0')
  return '#' + parts.slice(0, 3).map(channel).join('')
}

/** 取色器选完再转回 Wallpaper Engine 的 "r g b" 字符串。 */
export function hexToColor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return '1 1 1'
  const value = Number.parseInt(match[1], 16)
  const channel = (shift: number) => (((value >> shift) & 0xff) / 255).toFixed(3)
  return [channel(16), channel(8), channel(0)].join(' ')
}

/**
 * 这次要交给场景引擎的完整属性表：工程默认值 + 用户改过的覆盖值。
 *
 * 存下来的值来自 localStorage，可能是上一版留下的、也可能被手改坏了，所以逐项
 * 过一遍类型校验；认不出来的项直接退回工程默认值，而不是把 NaN 传给着色器。
 */
export function propertyValues(
  properties: WallpaperProperty[] | undefined,
  saved?: Record<string, unknown>
): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {}
  for (const property of properties ?? []) {
    const raw =
      saved && Object.prototype.hasOwnProperty.call(saved, property.name)
        ? saved[property.name]
        : property.value
    const value = coercePropertyValue(property, raw) ?? coercePropertyValue(property, property.value)
    if (value !== null) out[property.name] = value
  }
  return out
}

/**
 * 场景壁纸的画质档。
 *
 * 场景是常驻的 WebGL 循环，帧率和光栅化分辨率直接决定它吃多少 GPU 和电。
 * 壁纸只是背景，所以默认不开满：均衡档 30fps + 压到 1.25 dpr 已经够看。
 */
export type WallpaperQuality = 'saver' | 'balanced' | 'sharp'

export const DEFAULT_QUALITY: WallpaperQuality = 'balanced'

const QUALITIES: readonly WallpaperQuality[] = ['saver', 'balanced', 'sharp']

/** 存坏的值当成默认档，不要因为一个 localStorage 字符串把壁纸关掉。 */
export function parseQuality(raw: string | null): WallpaperQuality {
  return raw !== null && (QUALITIES as readonly string[]).includes(raw)
    ? (raw as WallpaperQuality)
    : DEFAULT_QUALITY
}

export interface SceneRenderOptions {
  fps: number
  renderDpr: number
}

/**
 * 把画质档换算成传给场景引擎的两个数。
 *
 * dpr 是屏幕的物理像素比，pixels 是窗口像素数——高分屏 + 大窗口时即使 1.25
 * 也已经很贵，所以再按 2.6M 像素总量兜一道（1080p 附近约等于不裁）。
 */
export function sceneRenderOptions(
  quality: WallpaperQuality,
  dpr: number,
  pixels: number
): SceneRenderOptions {
  const safeDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  const safePixels = Number.isFinite(pixels) && pixels > 0 ? pixels : 1
  const cap = Math.sqrt(2_600_000 / safePixels)

  if (quality === 'saver') {
    return { fps: 20, renderDpr: Math.max(0.75, Math.min(safeDpr, 1, cap)) }
  }
  if (quality === 'sharp') {
    return { fps: 60, renderDpr: Math.max(0.75, Math.min(safeDpr, cap)) }
  }
  return { fps: 30, renderDpr: Math.max(0.75, Math.min(safeDpr, 1.25, cap)) }
}
