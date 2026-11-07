/**
 * Generates the application icons from vector definitions.
 *
 * Why not render `scripts/icon.html` with a screenshot tool: a headless page
 * screenshot composites onto white and produces an RGB image with **no alpha
 * channel**, so the rounded corners ship as white blocks. App icons also need
 * several sizes, which one screenshot cannot provide.
 *
 * This rasterises the same design analytically (4x4 supersampling), keeps exact
 * alpha, and writes a multi-size Windows .ico plus a tray icon.
 *
 * Usage: node scripts/make-icons.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/*
 * Two destinations, for two different consumers.
 *
 * `build/` is electron-builder's buildResources directory: it is read at build
 * time to stamp the executable icon and is *not* copied into the packaged app.
 * `assets/icons/` is listed in the `files` config, so it ships inside the asar
 * and `nativeImage.createFromPath` can load it at run time. Putting the tray and
 * thumbnail glyphs in build/ would leave a packaged app with no tray icon.
 */
const buildDir = path.join(root, 'build')
const assetDir = path.join(root, 'assets', 'icons')

// --- PNG encoding ----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed), 0)
  return Buffer.concat([length, typed, crc])
}

/** Encode 8-bit RGBA pixels as a PNG. Filter 0 on every row keeps it simple. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: truecolour + alpha
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// --- colour helpers --------------------------------------------------------

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16)
]

/** Piecewise-linear gradient along the axis a -> b, in design coordinates. */
function linearStops(stops) {
  return stops.map(([offset, color, alpha = 1]) => ({ offset, rgb: hex(color), alpha }))
}

function sampleStops(stops, t) {
  const clamped = Math.min(1, Math.max(0, t))
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]
    const b = stops[i + 1]
    if (clamped <= b.offset) {
      const span = b.offset - a.offset || 1
      const k = (clamped - a.offset) / span
      return [
        a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k,
        a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k,
        a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k,
        a.alpha + (b.alpha - a.alpha) * k
      ]
    }
  }
  const last = stops[stops.length - 1]
  return [last.rgb[0], last.rgb[1], last.rgb[2], last.alpha]
}

function gradientAt(stops, from, to, x, y) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const lengthSq = dx * dx + dy * dy || 1
  return sampleStops(stops, ((x - from[0]) * dx + (y - from[1]) * dy) / lengthSq)
}

// --- geometry --------------------------------------------------------------

/** Cubic bezier flattened to a polyline, as flat [x0,y0,x1,y1,...]. */
function flattenCubic(p0, p1, p2, p3, steps = 40) {
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const u = 1 - t
    points.push(
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
    )
  }
  return points
}

function polylineBounds(line, pad) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < line.length; i += 2) {
    if (line[i] < minX) minX = line[i]
    if (line[i] > maxX) maxX = line[i]
    if (line[i + 1] < minY) minY = line[i + 1]
    if (line[i + 1] > maxY) maxY = line[i + 1]
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

function distanceToSegmentSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  let t = lengthSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) * (px - cx) + (py - cy) * (py - cy)
}

function distanceToPolylineSq(px, py, line) {
  let best = Infinity
  for (let i = 0; i + 3 < line.length; i += 2) {
    const d = distanceToSegmentSq(px, py, line[i], line[i + 1], line[i + 2], line[i + 3])
    if (d < best) best = d
  }
  return best
}

function insideRoundedRect(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) return false
  // Nearest point of the "core" rectangle; distance to it decides the corners.
  const limit = size - radius
  const cx = Math.min(Math.max(x, radius), limit)
  const cy = Math.min(Math.max(y, radius), limit)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

// --- the icon --------------------------------------------------------------

const DESIGN = 512

/*
 * The mark: a capital A drawn with three round-capped strokes.
 *
 * Earlier versions were three horizontal aurora arcs - a picture of the sky, not
 * a mark - and they turned into three grey lines in the taskbar. A letter survives
 * that far better. The plate carries the brand gradient and the letter is white,
 * which is the pair that still reads at 16 px and on a white page.
 */
const BG_GRAD = linearStops([
  [0, '#2ad9c8'],
  [0.3, '#36aef3'],
  [0.58, '#3f8cf5'],
  [0.82, '#6c6cf0'],
  [1, '#8f5cf0']
])

const APP_STROKES = [
  { line: straight(150, 410, 256, 104), width: 46 },
  { line: straight(362, 410, 256, 104), width: 46 },
  // 横杠两端收进腿内，不然圆头会从腿的外侧鼓出来。
  { line: straight(210, 304, 302, 304), width: 42 }
]

/** Line from a to b, as a two-point polyline, so the same distance code applies. */
function straight(ax, ay, bx, by) {
  return [ax, ay, bx, by]
}

/**
 * Distance from a point to the nearest A stroke, in design coordinates.
 *
 * Kept separate from the icon sampler because the installer art draws the same
 * letter at other scales: one definition means the mark cannot drift between the
 * executable icon and the wizard panel.
 */
function markDistance(x, y) {
  let nearest = Infinity
  let half = 0
  for (const stroke of APP_STROKES) {
    const box = stroke.box
    if (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY) continue
    const d = Math.sqrt(distanceToPolylineSq(x, y, stroke.line))
    if (d < nearest) {
      nearest = d
      half = stroke.width / 2
    }
  }
  return { nearest, half }
}

for (const stroke of APP_STROKES) {
  // The box also has to cover the soft edge around the letter.
  stroke.box = polylineBounds(stroke.line, stroke.width / 2 + 64)
}

/**
 * Premultiplied one-sample evaluation of the app icon at design coordinates.
 *
 * The A keeps its round caps but is drawn 8% smaller than the shared geometry so
 * it never touches the rounded corners at 128 px and up.
 */
function sampleAppIcon(x, y) {
  if (!insideRoundedRect(x, y, DESIGN, 116)) return [0, 0, 0, 0]
  const bg = gradientAt(BG_GRAD, [0.05 * DESIGN, 0], [0.95 * DESIGN, DESIGN], x, y)
  // Vignette: the middle of the plate stays luminous, the corners settle down.
  const vx = x - 0.5 * DESIGN
  const vy = y - 0.42 * DESIGN
  const vign = 1.06 - 0.18 * Math.min(1, Math.sqrt(vx * vx + vy * vy) / (0.78 * DESIGN)) ** 2
  const r0 = bg[0] * vign
  const g0 = bg[1] * vign
  const b0 = bg[2] * vign

  const mx = 0.5 * DESIGN + (x - 0.5 * DESIGN) / 0.92
  const my = 0.5 * DESIGN + (y - 0.5 * DESIGN) / 0.92
  const { nearest, half } = markDistance(mx, my)
  if (nearest <= half) return [255, 255, 255, 255]
  if (nearest <= half + 16) {
    // A shadow side, not an outline: the letter darkens the gradient under its own
    // edge by a few percent, which separates it from the light part of the plate.
    const a = 0.16 * (1 - (nearest - half) / 16) ** 2
    return [r0 * (1 - a), g0 * (1 - a), b0 * (1 - a), 255]
  }
  return [r0, g0, b0, 255]
}

/**
 * Rasterise with supersampling. Averaging happens in premultiplied space,
 * otherwise the colour of edge pixels bleeds toward black.
 */
function render(width, height, sampler, designWidth = width, designHeight = height) {
  const out = Buffer.alloc(width * height * 4)
  const scaleX = designWidth / width
  const scaleY = designHeight / height
  const SUB = 4
  const taps = SUB * SUB
  const stepX = scaleX / SUB
  const stepY = scaleY / SUB

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let sr = 0
      let sg = 0
      let sb = 0
      let sa = 0

      for (let sy = 0; sy < SUB; sy += 1) {
        const y = py * scaleY + sy * stepY + stepY / 2
        for (let sx = 0; sx < SUB; sx += 1) {
          const x = px * scaleX + sx * stepX + stepX / 2
          const [r, g, b, a] = sampler(x, y)
          if (a === 0) continue
          const w = a / 255
          sr += r * w
          sg += g * w
          sb += b * w
          sa += w
        }
      }

      const index = (py * width + px) * 4
      if (sa > 0) {
        out[index] = Math.round(Math.min(255, sr / sa))
        out[index + 1] = Math.round(Math.min(255, sg / sa))
        out[index + 2] = Math.round(Math.min(255, sb / sa))
        out[index + 3] = Math.round((sa / taps) * 255)
      }
    }
  }

  return out
}

// --- ICO container ---------------------------------------------------------

/** Windows .ico holding PNG payloads (supported since Vista). */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(entries.length * 16)
  let offset = 6 + entries.length * 16

  entries.forEach((entry, i) => {
    const at = i * 16
    directory[at] = entry.size >= 256 ? 0 : entry.size
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size
    directory[at + 2] = 0
    directory[at + 3] = 0
    directory.writeUInt16LE(1, at + 4)
    directory.writeUInt16LE(32, at + 6)
    directory.writeUInt32LE(entry.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)])
}

// --- simple shape rasteriser, for the transport and tray glyphs -------------

function sign(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by)
}

function inTriangle(px, py, [a, b, c]) {
  const d1 = sign(px, py, a[0], a[1], b[0], b[1])
  const d2 = sign(px, py, b[0], b[1], c[0], c[1])
  const d3 = sign(px, py, c[0], c[1], a[0], a[1])
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNegative && hasPositive)
}

/** White glyphs on transparent, matching the Windows thumbnail toolbar. */
const GLYPHS = {
  play: [{ type: 'tri', p: [[10, 6.5], [10, 25.5], [24.5, 16]] }],
  pause: [
    { type: 'rect', x: 9.5, y: 6.5, w: 4.5, h: 19 },
    { type: 'rect', x: 18, y: 6.5, w: 4.5, h: 19 }
  ],
  prev: [
    { type: 'rect', x: 6.5, y: 6.5, w: 3.4, h: 19 },
    { type: 'tri', p: [[25.5, 6.5], [25.5, 25.5], [11.5, 16]] }
  ],
  next: [
    { type: 'rect', x: 22.1, y: 6.5, w: 3.4, h: 19 },
    { type: 'tri', p: [[6.5, 6.5], [6.5, 25.5], [20.5, 16]] }
  ]
}

function sampleShapes(shapes, colour, x, y) {
  for (const shape of shapes) {
    let hit = false
    if (shape.type === 'rect') {
      hit = x >= shape.x && x <= shape.x + shape.w && y >= shape.y && y <= shape.y + shape.h
    } else if (shape.type === 'tri') {
      hit = inTriangle(x, y, shape.p)
    } else if (shape.type === 'stroke') {
      const half = shape.width / 2
      hit = distanceToPolylineSq(x, y, shape.line) <= half * half
    }
    if (hit) return [colour[0], colour[1], colour[2], 255]
  }
  return [0, 0, 0, 0]
}

/** The tray mark expressed as strokes so the same sampler can draw it. */
const TRAY_STROKES = [
  { type: 'stroke', line: straight(10, 26, 16, 8), width: 3.4 },
  { type: 'stroke', line: straight(22, 26, 16, 8), width: 3.4 },
  { type: 'stroke', line: straight(12.4, 19, 19.6, 19), width: 3.2 }
]

const WHITE = hex('#ffffff')
const TRAY_DARK = hex('#1b2027')

// --- main ------------------------------------------------------------------

fs.mkdirSync(buildDir, { recursive: true })
fs.mkdirSync(assetDir, { recursive: true })

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoEntries = []

for (const size of icoSizes) {
  const pixels = render(size, size, sampleAppIcon, DESIGN, DESIGN)
  const png = encodePng(size, size, pixels)
  icoEntries.push({ size, png })
  if (size === 256) fs.writeFileSync(path.join(buildDir, 'icon.png'), png)
}

fs.writeFileSync(path.join(buildDir, 'icon.ico'), encodeIco(icoEntries))

/*
 * The tray mark needs to survive both taskbar themes: Windows does not invert
 * an Electron tray image, so a white glyph vanishes on a light taskbar and a
 * dark one vanishes on the dark default. Both variants are generated and the
 * main process picks by `nativeTheme.shouldUseDarkColors`.
 */
for (const [suffix, colour] of [
  ['', WHITE],
  ['-dark', TRAY_DARK]
]) {
  for (const size of [16, 32]) {
    const pixels = render(size, size, (x, y) => sampleShapes(TRAY_STROKES, colour, x, y), 32, 32)
    const name = size === 16 ? `tray${suffix}.png` : `tray${suffix}@2x.png`
    fs.writeFileSync(path.join(assetDir, name), encodePng(size, size, pixels))
  }
}

/* 16px is what the Windows thumbnail toolbar asks for; 32px covers 200% DPI. */
for (const [name, shapes] of Object.entries(GLYPHS)) {
  for (const size of [16, 32]) {
    const pixels = render(size, size, (x, y) => sampleShapes(shapes, WHITE, x, y), 32, 32)
    fs.writeFileSync(
      path.join(assetDir, `thumb-${name}${size === 16 ? '' : '@2x'}.png`),
      encodePng(size, size, pixels)
    )
  }
}

const report = (dir, name) => {
  const stat = fs.statSync(path.join(dir, name))
  console.log(`  ${path.relative(root, path.join(dir, name)).padEnd(28)} ${String(stat.size).padStart(7)} bytes`)
}

for (const dir of [buildDir, assetDir]) {
  const names = fs.readdirSync(dir).sort()
  console.log(`${path.relative(root, dir)}/  (${names.length} files)`)
  for (const name of names) report(dir, name)
}

// --- installer art ---------------------------------------------------------

/*
 * electron-builder's NSIS target wants two bitmaps no browser can produce: the
 * 164x314 sidebar panel and the 150x57 header strip. They are rasterised here
 * with the same sampler as the icon, so the first screen of the installer is the
 * mark the user is about to launch. BMP, not PNG: NSIS loads them through its own
 * decoder.
 */

function encodeBmp(width, height, rgba) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixels = Buffer.alloc(rowSize * height)
  for (let y = 0; y < height; y += 1) {
    // BMP rows are bottom-up, and the bytes are BGR.
    const sourceY = height - 1 - y
    for (let x = 0; x < width; x += 1) {
      const at = (sourceY * width + x) * 4
      const out = y * rowSize + x * 3
      pixels[out] = rgba[at + 2]
      pixels[out + 1] = rgba[at + 1]
      pixels[out + 2] = rgba[at]
    }
  }

  const header = Buffer.alloc(14)
  header.write('BM', 0, 'ascii')
  header.writeUInt32LE(14 + 40 + pixels.length, 2)
  header.writeUInt32LE(14 + 40, 10)

  const dib = Buffer.alloc(40)
  dib.writeUInt32LE(40, 0)
  dib.writeInt32LE(width, 4)
  dib.writeInt32LE(height, 8)
  dib.writeUInt16LE(1, 12)
  dib.writeUInt16LE(24, 14)
  dib.writeUInt32LE(pixels.length, 20)
  dib.writeInt32LE(2835, 24)
  dib.writeInt32LE(2835, 28)

  return Buffer.concat([header, dib, pixels])
}

/** Signed distance to the A mark in panel pixels: <= 0 is inside the letter. */
function markSignedAt(x, y, cx, cy, height) {
  const scale = height / 306
  const dx = (x - cx) / scale + 256
  const dy = (y - cy) / scale + 256
  const { nearest, half } = markDistance(dx, dy)
  return (nearest - half) * scale
}

const SIDEBAR_W = 164
const SIDEBAR_H = 314

/*
 * Left panel of the NSIS wizard: the gradient plate and the white letter, the same
 * pair as the app icon. No text - the wizard already says Aurora everywhere, and
 * rasterised type at this size would only look broken.
 */
function sampleSidebar(x, y) {
  const bg = gradientAt(BG_GRAD, [0, 0], [SIDEBAR_W, SIDEBAR_H], x, y)
  const vx = x - SIDEBAR_W * 0.5
  const vy = y - SIDEBAR_H * 0.38
  const vign = 1.05 - 0.17 * Math.min(1, Math.sqrt(vx * vx + vy * vy) / (0.78 * SIDEBAR_H)) ** 2
  let r = bg[0] * vign
  let g = bg[1] * vign
  let b = bg[2] * vign

  if (markSignedAt(x, y, SIDEBAR_W / 2, 146, 122) <= 0) return [255, 255, 255, 255]

  if (y >= 260 && y < 262 && x > 30 && x < 134) {
    r += (255 - r) * 0.42
    g += (255 - g) * 0.42
    b += (255 - b) * 0.42
  }
  if (y >= 272 && y < 274 && x > 30 && x < 88) {
    r += (255 - r) * 0.2
    g += (255 - g) * 0.2
    b += (255 - b) * 0.2
  }
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b), 255]
}

const HEADER_W = 150
const HEADER_H = 57

const HEADER_INK = linearStops([
  [0, '#0f9e8d'],
  [0.5, '#2563d8'],
  [1, '#5b3fd0']
])

/*
 * Header strip: pale on purpose. NSIS draws the wizard's step title in black to
 * the right of this bitmap and electron-builder gives no hook to recolour it, so
 * a saturated plate here would hide the text. The brand survives as the gradient
 * letter on the left.
 */
function sampleHeader(x, y) {
  if (markSignedAt(x, y, 42, HEADER_H / 2 - 2, 38) <= 0) {
    return gradientAt(HEADER_INK, [42 - 22, 6], [42 + 22, HEADER_H - 6], x, y)
  }
  return gradientAt(
    linearStops([
      [0, '#ffffff'],
      [0.55, '#f4f8ff'],
      [1, '#e8f1ff']
    ]),
    [0, 0],
    [HEADER_W, 0],
    x,
    y
  )
}

const sidebarPixels = render(SIDEBAR_W, SIDEBAR_H, sampleSidebar, SIDEBAR_W, SIDEBAR_H)
const sidebarBmp = encodeBmp(SIDEBAR_W, SIDEBAR_H, sidebarPixels)
fs.writeFileSync(path.join(buildDir, 'installerSidebar.bmp'), sidebarBmp)
fs.writeFileSync(path.join(buildDir, 'uninstallerSidebar.bmp'), sidebarBmp)
// PNG twins of the installer art: NSIS needs BMP, but a reviewer needs an image a
// normal viewer can open. Harmless in buildResources - the packaging config never
// references them.
fs.writeFileSync(path.join(buildDir, 'installerSidebar.png'), encodePng(SIDEBAR_W, SIDEBAR_H, sidebarPixels))

const headerPixels = render(HEADER_W, HEADER_H, sampleHeader, HEADER_W, HEADER_H)
fs.writeFileSync(path.join(buildDir, 'installerHeader.bmp'), encodeBmp(HEADER_W, HEADER_H, headerPixels))
fs.writeFileSync(path.join(buildDir, 'installerHeader.png'), encodePng(HEADER_W, HEADER_H, headerPixels))

console.log('installer art written to build/')
