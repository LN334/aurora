import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COVER_DISK_BUDGET,
  coverEvictions
} from '../electron/pure/cover-cache-rules.ts'

const MB = 1024 * 1024
/** 保留线：清到 90%，与实现里的口径一致。 */
const KEEP_BYTES = Math.round(COVER_DISK_BUDGET * 0.9)

function file(name: string, at: number, size: number) {
  return { name, at, size }
}

test('预算内一个都不删', () => {
  const files = [file('a.jpg', 1, 2 * MB), file('b.jpg', 2, 3 * MB)]
  assert.deepEqual(coverEvictions(files), [])
})

test('超过 200 MB 时按最久没用删到保留线以内', () => {
  // 三张 80 MB 的图：总共 240 MB，删掉最旧的一张就回到 160 MB（< 180 MB）。
  const files = [file('new.jpg', 30, 80 * MB), file('old.jpg', 10, 80 * MB), file('mid.jpg', 20, 80 * MB)]
  assert.deepEqual(coverEvictions(files), ['old.jpg'])

  // 四张 80 MB：删到剩两张才低于 180 MB。
  const four = [
    file('d.jpg', 40, 80 * MB),
    file('a.jpg', 10, 80 * MB),
    file('c.jpg', 30, 80 * MB),
    file('b.jpg', 20, 80 * MB)
  ]
  const dropped = coverEvictions(four)
  assert.deepEqual(dropped, ['a.jpg', 'b.jpg'])
  assert.ok(4 * 80 * MB - dropped.length * 80 * MB <= KEEP_BYTES)
})

test('文件数超过 4000 时也清，哪怕字节数很低', () => {
  const files = Array.from({ length: 4001 }, (_, index) => file(`p${index}.jpg`, index, 1024))
  const dropped = coverEvictions(files)
  // 只需删掉最旧的一个就不再超 4000；但保留线是 3000，所以会一路清到 3000。
  assert.equal(dropped.length, 1001)
  assert.equal(dropped[0], 'p0.jpg')
  assert.equal(files.length - dropped.length, 3000)
})

test('总字节正好等于上限时不清理', () => {
  const files = [file('a.jpg', 1, COVER_DISK_BUDGET - MB), file('b.jpg', 2, MB)]
  assert.deepEqual(coverEvictions(files), [])
})

test('同一毫秒的按文件名排序，结果与输入顺序无关', () => {
  // 三张 70 MB：总共 210 MB，删一张就回到 140 MB（< 180 MB 保留线）。
  const files = [file('b.jpg', 5, 70 * MB), file('a.jpg', 5, 70 * MB), file('c.jpg', 5, 70 * MB)]
  const first = coverEvictions(files)
  const shuffled = [files[2], files[0], files[1]]
  assert.deepEqual(coverEvictions(shuffled), first)
  assert.deepEqual(first, ['a.jpg'])
})
