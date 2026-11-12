import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeIco, roundCorners } from '../electron/pure/app-icon-shape.ts'

/** 一整套不透明的 BGRA 像素，alpha 全 255。 */
function square(size: number): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 200
    pixels[i + 1] = 100
    pixels[i + 2] = 50
    pixels[i + 3] = 255
  }
  return pixels
}

const alphaAt = (bitmap: Buffer, size: number, x: number, y: number): number =>
  bitmap[(y * size + x) * 4 + 3]

test('roundCorners 把四角擦掉，边上和中间一个像素不动', () => {
  const size = 64
  const bitmap = square(size)
  roundCorners(bitmap, size, size, 0.17)

  // 四角必须完全透明，否则深色任务栏上会露白角——这是这个函数存在的全部理由
  assert.equal(alphaAt(bitmap, size, 0, 0), 0)
  assert.equal(alphaAt(bitmap, size, size - 1, 0), 0)
  assert.equal(alphaAt(bitmap, size, 0, size - 1), 0)
  assert.equal(alphaAt(bitmap, size, size - 1, size - 1), 0)

  // 四条边的中点与中心都在矩形内部
  assert.equal(alphaAt(bitmap, size, size / 2, 0), 255)
  assert.equal(alphaAt(bitmap, size, size / 2, size - 1), 255)
  assert.equal(alphaAt(bitmap, size, size / 2, size / 2), 255)

  // 只改 alpha：颜色一个字节都不能动
  assert.equal(bitmap[0], 200)
  assert.equal(bitmap[1], 100)
  assert.equal(bitmap[2], 50)
})

test('roundCorners 半径为零时原样返回', () => {
  const size = 32
  const before = square(size)
  const after = Buffer.from(before)
  roundCorners(after, size, size, 0)
  assert.deepEqual(after, before)
})

test('encodeIco 写出可用的目录，256 记作 0', () => {
  const entries = [
    { size: 16, png: Buffer.from([1, 2, 3]) },
    { size: 256, png: Buffer.from([4, 5]) }
  ]
  const ico = encodeIco(entries)

  assert.equal(ico.readUInt16LE(0), 0, 'reserved')
  assert.equal(ico.readUInt16LE(2), 1, 'type = icon')
  assert.equal(ico.readUInt16LE(4), 2, 'count')

  // 第一项：16×16，数据紧接目录（6 + 2 × 16 = 38）
  assert.equal(ico[6], 16)
  assert.equal(ico[7], 16)
  assert.equal(ico.readUInt16LE(6 + 4), 1, 'planes')
  assert.equal(ico.readUInt16LE(6 + 6), 32, 'bit count')
  assert.equal(ico.readUInt32LE(6 + 8), 3, '第一张的长度')
  assert.equal(ico.readUInt32LE(6 + 12), 38, '第一张的偏移')

  // 第二项：256 一个字节装不下，目录里按格式规定记 0
  assert.equal(ico[22], 0)
  assert.equal(ico[23], 0)
  assert.equal(ico.readUInt32LE(22 + 12), 41, '第二张的偏移')
  assert.equal(ico.length, 6 + 32 + 5)
})

test('encodeIco 空数组直接报错，不生成一个打不开的文件', () => {
  assert.throws(() => encodeIco([]), /at least one entry/)
})
