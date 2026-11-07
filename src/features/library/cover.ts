/**
 * Deterministic placeholder artwork.
 *
 * Used for design previews and screenshots so the interface can be judged with
 * a populated library before any real files exist. Real artwork always wins:
 * this is only a fallback for the demo dataset.
 *
 * Each cover is one soft wash for depth plus a crisp geometric subject. The
 * crisp layer is the point - all-blurred gradient blobs read as generated filler
 * rather than as artwork, and the dominant-colour extractor needs real edge
 * colours to have anything interesting to find.
 */

function hashOf(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const LAYOUTS = 3

export function coverFor(seed: string, size = 512): string {
  const h = hashOf(seed)
  const hue = h % 360
  const layout = (h >> 9) % LAYOUTS
  const s = size
  const round = (value: number) => value.toFixed(1)

  const strong = `hsl(${hue} 76% 58%)`
  const mid = `hsl(${(hue + 34) % 360} 70% 46%)`
  const deep = `hsl(${(hue + 316) % 360} 64% 24%)`
  const pale = `hsl(${(hue + 12) % 360} 82% 76%)`

  const washBlur = `<filter id="wash" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${round(s * 0.11)}"/>
    </filter>`

  const washX = 0.24 + ((h >> 17) % 50) / 100
  const washY = 0.2 + ((h >> 21) % 55) / 100
  const wash = `<g filter="url(#wash)">
      <circle cx="${round(s * washX)}" cy="${round(s * washY)}" r="${round(s * 0.34)}" fill="${strong}"/>
      <circle cx="${round(s * (1 - washX))}" cy="${round(s * (1 - washY))}" r="${round(s * 0.27)}" fill="${mid}"/>
    </g>`

  const stroke = round(s * 0.009)
  let subject = ''

  if (layout === 0) {
    // Concentric rings, cropped by the frame.
    const cx = s * (0.34 + ((h >> 5) % 32) / 100)
    const cy = s * (0.4 + ((h >> 7) % 26) / 100)
    subject =
      `<g fill="none" stroke="${pale}" stroke-width="${stroke}" opacity="0.9">` +
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(s * 0.3)}"/>` +
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(s * 0.2)}" opacity="0.55"/>` +
      `</g>` +
      `<circle cx="${round(s * 0.73)}" cy="${round(s * 0.3)}" r="${round(s * 0.045)}" fill="${pale}"/>`
  } else if (layout === 1) {
    // A horizon: solid mass at the base, a disc above it.
    const horizon = s * (0.58 + ((h >> 6) % 12) / 100)
    const discR = s * (0.09 + ((h >> 11) % 8) / 100)
    subject =
      `<rect x="0" y="${round(horizon)}" width="${s}" height="${round(s - horizon)}" fill="${deep}"/>` +
      `<circle cx="${round(s * 0.68)}" cy="${round(horizon - discR * 0.7)}" r="${round(discR)}" fill="${pale}"/>` +
      `<g stroke="${pale}" stroke-width="${stroke}" opacity="0.6">` +
      `<line x1="0" y1="${round(horizon)}" x2="${s}" y2="${round(horizon)}"/>` +
      `<line x1="0" y1="${round(horizon + s * 0.055)}" x2="${round(s * 0.62)}" y2="${round(horizon + s * 0.055)}"/>` +
      `</g>`
  } else {
    // A tilted frame and a disc: a record sleeve, not a bar graph. The earlier
    // equal-width column set read as a spectrum analyser, which is exactly the
    // thing this app does not draw outside the stage.
    const cx = s * 0.5
    const cy = s * 0.5
    const half = s * 0.3
    subject =
      `<g transform="rotate(${round((h >> 13) % 30 - 15)} ${round(cx)} ${round(cy)})">` +
      `<rect x="${round(cx - half)}" y="${round(cy - half)}" width="${round(half * 2)}" height="${round(half * 2)}" ` +
      `rx="${round(s * 0.03)}" fill="none" stroke="${pale}" stroke-width="${stroke}" opacity="0.85"/>` +
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(s * 0.135)}" fill="${deep}"/>` +
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(s * 0.135)}" fill="none" stroke="${pale}" stroke-width="${stroke}" opacity="0.6"/>` +
      `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(s * 0.022)}" fill="${pale}"/>` +
      `</g>` +
      `<line x1="${round(s * 0.62)}" y1="${round(s * 0.82)}" x2="${round(s * 0.9)}" y2="${round(s * 0.82)}" ` +
      `stroke="${pale}" stroke-width="${stroke}" opacity="0.45"/>`
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
    `<defs>${washBlur}` +
    `<linearGradient id="base" x1="0" y1="0" x2="0.65" y2="1">` +
    `<stop offset="0" stop-color="${deep}"/>` +
    `<stop offset="1" stop-color="#07090c"/>` +
    `</linearGradient>` +
    `<radialGradient id="vig" cx="0.5" cy="0.42" r="0.8">` +
    `<stop offset="0.5" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="0.5"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="${s}" height="${s}" fill="url(#base)"/>` +
    wash +
    subject +
    `<rect width="${s}" height="${s}" fill="url(#vig)"/>` +
    `</svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
