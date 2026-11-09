/*
 * 液态玻璃的位移贴图。
 *
 * 思路借自 shuding/liquid-glass（MIT）：拿一张「每个像素往哪挪多少」的 RGB 贴图，
 * 交给 feDisplacementMap 去弯折 backdrop-filter 背后的真实像素——折射的是真背景，
 * 不是画上去的高光，所以窗口怎么滚、壁纸怎么动，边缘那一圈都跟着对。
 *
 * 与原作不同的两处：
 *   1. 贴图按元素的实际像素尺寸和圆角生成，不再用归一化的 0.3/0.2。原作那套是给
 *      固定 300x200 的玻璃调的，放到 1600x84 的播放条上，圆角会被拉成极扁的椭圆，
 *      折射圈只在上下各剩一条缝。按像素算，任何尺寸的元素边缘厚度都一致，这才像
 *      同一块玻璃切出来的。
 *   2. 位移方向取 SDF 的梯度（真正的内法线），不是「从中心指向像素」的径向。径向
 *      在长条的两端会把内容横向拽走，看起来像被拉花；法线方向下直边只垂直弯、
 *      圆角才斜着弯，跟真玻璃一致。
 *
 * 幅度上限：位移量必须小于折射圈本身，否则边缘采到的是十几像素外的内容，观感是
 * 「糊了一圈」而不是「弯了一下」。edge * strength 就是这个上限，0.5 前后是常态。
 */

export interface DisplacementMap {
  /** PNG data URL，喂给 feImage。 */
  href: string
  /** feDisplacementMap 的 scale，单位 CSS px。 */
  scale: number
}

/** 圆角矩形的有符号距离：负数在内部，0 落在边界上。 */
function sdRoundRect(x: number, y: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(x) - hw + r
  const qy = Math.abs(y) - hh + r
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

/*
 * 同一块玻璃会被反复重算（开合面板、改窗口大小），而贴图只跟尺寸和参数有关，
 * 所以按 key 缓存。上限压得低：一张 1600x84 的 PNG 解码后是几 MB 位图，缓存
 * 太多反而挤占 GPU 纹理。
 */
const CACHE = new Map<string, DisplacementMap>()
const CACHE_LIMIT = 12

export function displacementMap(
  width: number,
  height: number,
  radius: number,
  edge: number,
  strength: number
): DisplacementMap | null {
  const w = Math.max(2, Math.round(width))
  const h = Math.max(2, Math.round(height))
  const r = Math.max(0, Math.min(radius, h / 2, w / 2))
  const band = Math.max(2, Math.min(edge, h * 0.46))
  const key = `${w}x${h}r${Math.round(r)}e${band.toFixed(1)}s${strength}`

  const hit = CACHE.get(key)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const image = ctx.createImageData(w, h)
  const hw = w / 2
  const hh = h / 2
  const count = w * h
  const dxs = new Float32Array(count)
  const dys = new Float32Array(count)
  let peak = 1e-6

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const px = x + 0.5 - hw
      const py = y + 0.5 - hh
      // t: 0 在折射圈内侧（不动），1 在边界上（位移最大）
      const t = Math.min(1, Math.max(0, 1 + sdRoundRect(px, py, hw, hh, r) / band))
      const ease = t * t * (3 - 2 * t)
      // 梯度用中心差分，四个点就够——SDF 是解析的，不存在采样噪声
      const gx =
        sdRoundRect(px + 1, py, hw, hh, r) - sdRoundRect(px - 1, py, hw, hh, r)
      const gy =
        sdRoundRect(px, py + 1, hw, hh, r) - sdRoundRect(px, py - 1, hw, hh, r)
      const len = Math.hypot(gx, gy) || 1
      const push = (ease * band * strength) / len
      const dx = -gx * push
      const dy = -gy * push
      const i = y * w + x
      dxs[i] = dx
      dys[i] = dy
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      if (ax > peak) peak = ax
      if (ay > peak) peak = ay
    }
  }

  /*
   * feDisplacementMap 的公式是 P' = P + (C - 0.5) * scale，C 是通道值 0..1。
   * 把 dx 映射到 [0,1] 时除以 2*peak，正好让 scale = 2*peak 还原成 dx 像素。
   * 不做这个归一化，R 通道会被裁到 0..255，折射在强位移处就断了。
   */
  const data = image.data
  for (let i = 0; i < count; i += 1) {
    const k = i * 4
    data[k] = Math.round((dxs[i] / (2 * peak) + 0.5) * 255)
    data[k + 1] = Math.round((dys[i] / (2 * peak) + 0.5) * 255)
    data[k + 2] = 0
    data[k + 3] = 255
  }
  ctx.putImageData(image, 0, 0)

  const map: DisplacementMap = { href: canvas.toDataURL('image/png'), scale: 2 * peak }

  if (CACHE.size >= CACHE_LIMIT) {
    const oldest = CACHE.keys().next().value
    if (oldest !== undefined) CACHE.delete(oldest)
  }
  CACHE.set(key, map)
  return map
}
