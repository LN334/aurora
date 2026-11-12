/**
 * 图标的两个纯函数：切圆角、装 .ico 容器。
 *
 * 放在 pure/ 是因为它们不碰 Electron：主进程调用，单元测试也调用。圆角那点
 * 像素数学不该只能靠「跑起来截个图看一眼」来验证——四角透没透、缩到 16px 有
 * 没有锯齿，都能在这里算清楚。
 */

/**
 * 把一张方形位图的四角切圆（就地改 alpha）。
 *
 * 输入是 `nativeImage.toBitmap()` 的原始位图：BGRA、逐行、无行首填充。只动
 * alpha，圆角之外置 0、圆内原样，所以不管像素是不是预乘过的都成立。
 *
 * 半径按边长比例给：设计稿那枚图标是 17%，与这里默认值一致。
 *
 * @param bitmap BGRA 像素，长度需等于 width * height * 4
 * @param radius 圆角半径 / 边长
 */
export function roundCorners(
  bitmap: Buffer,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(width, height) * radius
  if (r <= 0) return
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      /*
       * 圆角矩形 = 中间一整块 + 四个 1/4 圆。像素到「最近那个圆心」的距离超过
       * 半径就在外面。cx/cy 取的是到两条直边的距离，两者都为 0 表示这个像素
       * 在中间那块里。
       */
      const cx = Math.max(r - (x + 0.5), x + 0.5 - (width - r), 0)
      const cy = Math.max(r - (y + 0.5), y + 0.5 - (height - r), 0)
      if (cx === 0 && cy === 0) continue
      const dist = Math.sqrt(cx * cx + cy * cy)
      // 边缘一像素内线性过渡，否则 32px 以下会看到明显的阶梯
      const cover = Math.min(1, Math.max(0, r - dist + 0.5))
      if (cover >= 1) continue
      const at = (y * width + x) * 4
      bitmap[at + 3] = Math.round(bitmap[at + 3] * cover)
    }
  }
}

interface IcoEntry {
  /** 边长为该尺寸的正方形 PNG。 */
  png: Buffer
  size: number
}

/**
 * 把若干张 PNG 装进一个 Windows .ico。
 *
 * 目录项里宽高各占一个字节，所以 256 要记作 0——这是格式本身的规定，不是笔误。
 * 从 Vista 起 .ico 允许直接内嵌 PNG，不必再退回 BMP 那套。
 */
export function encodeIco(entries: IcoEntry[]): Buffer {
  if (entries.length === 0) throw new Error('encodeIco needs at least one entry')

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
