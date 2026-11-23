/**
 * The two numbers the desktop lyric window has to compute before it can paint:
 * how bright the already-sung colour should be, and how much the line has to be
 * shrunk to fit the window.
 *
 * Both are pure so the strip's appearance can be asserted without a screen.
 */

/** What the sung colour falls back to when the artwork gave us nothing usable. */
const FALLBACK = '#8fb6e6'

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

type Rgb = [number, number, number]

function parseHex(value: string): Rgb | null {
  const text = value.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text)
  if (short) {
    return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16)]
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text)
  if (!full) return null
  return [parseInt(full[1], 16), parseInt(full[2], 16), parseInt(full[3], 16)]
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`
}

/** Hue in degrees, saturation and lightness in 0..1. */
function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  if (delta === 0) return [0, 0, lightness]
  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue: number
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4
  return [(hue * 60 + 360) % 360, clamp(saturation, 0, 1), lightness]
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const sector = hue / 60
  const second = chroma * (1 - Math.abs((sector % 2) - 1))
  const match = lightness - chroma / 2
  let rgb: [number, number, number]
  if (sector < 1) rgb = [chroma, second, 0]
  else if (sector < 2) rgb = [second, chroma, 0]
  else if (sector < 3) rgb = [0, chroma, second]
  else if (sector < 4) rgb = [0, second, chroma]
  else if (sector < 5) rgb = [second, 0, chroma]
  else rgb = [chroma, 0, second]
  return rgb.map((channel) => (channel + match) * 255) as Rgb
}

/**
 * Colour of the sung part of the line.
 *
 * Taking the artwork accent as-is is what made the old strip look dead: covers
 * hand out muted, mid-dark colours (`#7d8899` on the idle palette), and a muted
 * colour on top of white text reads as "slightly off-white", not as progress.
 * So the accent keeps its hue, but saturation and lightness are pulled into the
 * band where a hue is recognisable and the glyph still separates from the white
 * unsung copy underneath — a coloured highlight, not a second grey.
 */
export function sungColor(accent: string): string {
  const rgb = parseHex(accent)
  if (!rgb) return FALLBACK
  const [hue, saturation, lightness] = rgbToHsl(rgb)
  const sungSaturation = clamp(Math.max(saturation, 0.62), 0, 0.95)
  const sungLightness = clamp(lightness, 0.64, 0.8)
  return toHex(hslToRgb(hue, sungSaturation, sungLightness))
}

/**
 * Font size that keeps one line inside the window.
 *
 * A lyric line has no natural place to break: wrapping it turns a phrase into
 * two, and clipping it eats the rhyme. Shrinking is the only option that keeps
 * the sentence readable, and 60% of the requested size is where it stops — below
 * that the strip no longer looks like a lyric overlay.
 */
export function fitLyricSize(size: number, measured: number, available: number): number {
  if (!(size > 0) || !(measured > 0) || !(available > 0)) return size
  if (measured <= available) return size
  return Math.max(size * 0.6, (available / measured) * size)
}
