/**
 * 液态玻璃的位移贴图。
 *
 * 移植自 shuding/liquid-glass（MIT）——但有一处必须改：上游的 SDF 是写死的
 * 300×200 归一化（半宽 0.3、半高 0.2）。贴到 1100×180 这种长条上，圆角会被
 * 拉成极扁的椭圆，折射只剩上下两条缝。这里按元素真实像素重算，并把位移方向
 * 取作 SDF 的内法线——从中心向外会把内容横向拽走。
 *
 * 编码（feDisplacementMap 的约定）：位移 = scale × (c / 255 − 0.5)。
 *   R = 128 + dx / max × 127、G = 128 + dy / max × 127、B 不用、A 不透明。
 */
export interface DisplacementMap {
  /** data:image/png;base64,... */
  url: string
  /** feDisplacementMap 的 scale，等于贴图里最大的像素位移 */
  scale: number
}

export interface DisplacementInput {
  width: number
  height: number
  /** 圆角，像素 */
  radius: number
  /** 边带宽度：从边界往里多少像素内发生位移，像素 */
  edge: number
}

/** 圆角矩形的有符号距离：内部为负，边界为 0。 */
function roundedRect(x: number, y: number, halfWidth: number, halfHeight: number, radius: number): number {
  const innerX = halfWidth - radius
  const innerY = halfHeight - radius
  const qx = Math.abs(x) - innerX
  const qy = Math.abs(y) - innerY
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  return outside + Math.min(Math.max(qx, qy), 0) - radius
}

function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function buildDisplacementMap({ width, height, radius, edge }: DisplacementInput): DisplacementMap | null {
  if (width < 8 || height < 8) return null

  const w = Math.round(width)
  const h = Math.round(height)
  const hw = w / 2
  const hh = h / 2
  // 圆角比盒子还大时（999px 药丸）按短边一半收住。
  const r = Math.min(Math.max(radius, 0), Math.min(hw, hh))
  const band = Math.max(2, Math.min(edge, Math.min(hw, hh) * 0.9))

  const data = new Uint8ClampedArray(w * h * 4)
  const dx = new Float32Array(w * h)
  const dy = new Float32Array(w * h)
  let max = 0

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const px = x + 0.5 - hw
      const py = y + 0.5 - hh
      const distance = roundedRect(px, py, hw, hh, r)
      // 边界以外（distance > 0）不参与：那部分会被裁掉。
      if (distance > 0) continue

      const depth = -distance
      // 1 贴着边、0 在内部：中间用 smoothstep 过渡，别出现折线。
      const falloff = smoothStep(0, band, depth)
      const push = 1 - falloff
      if (push <= 0) continue

      // 数值梯度取指向外侧的方向，取反就是内法线。
      const step = 1
      const gx = roundedRect(px + step, py, hw, hh, r) - roundedRect(px - step, py, hw, hh, r)
      const gy = roundedRect(px, py + step, hw, hh, r) - roundedRect(px, py - step, hw, hh, r)
      const length = Math.hypot(gx, gy) || 1
      const nx = -gx / length
      const ny = -gy / length

      // 0.5 是量感：band=24 时最大位移 12px。按上游的比例（300 宽的卡 scale≈192）
      // 贴到 1100×84 的长条上会明显扭曲，长条只需要边缘「折一下」。
      const amount = push * band * 0.5
      const index = y * w + x
      dx[index] = nx * amount
      dy[index] = ny * amount
      max = Math.max(max, Math.abs(dx[index]), Math.abs(dy[index]))
    }
  }

  if (max < 0.5) return null

  for (let i = 0; i < w * h; i += 1) {
    const at = i * 4
    data[at] = 128 + (dx[i] / max) * 127
    data[at + 1] = 128 + (dy[i] / max) * 127
    data[at + 2] = 0
    data[at + 3] = 255
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const context = canvas.getContext('2d')
  if (!context) return null
  context.putImageData(new ImageData(data, w, h), 0, 0)

  return { url: canvas.toDataURL('image/png'), scale: max }
}
