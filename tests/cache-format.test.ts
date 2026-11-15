import assert from 'node:assert/strict'
import test from 'node:test'
import { cacheLimitLabel, cacheSizeLabel } from '../src/features/settings/cache-format.ts'

test('上限文案把 0 读成不缓存，其余按 MB / GB', () => {
  assert.equal(cacheLimitLabel(0), '不缓存')
  assert.equal(cacheLimitLabel(512), '512 MB')
  assert.equal(cacheLimitLabel(2048), '2 GB')
  assert.equal(cacheLimitLabel(10_240), '10 GB')
})

test('占用为零时统一报 0 MB', () => {
  assert.equal(cacheSizeLabel(0), '0 MB')
  assert.equal(cacheSizeLabel(-1), '0 MB')
})

test('刚过 1 KB 也报 1 KB，不滑成 0', () => {
  assert.equal(cacheSizeLabel(1), '1 KB')
  assert.equal(cacheSizeLabel(512), '1 KB')
})

test('不到 1 MB 的条目按 KB 报，而不是四舍五入成 1 MB', () => {
  // 这正是回归用例：103070 字节 ≈ 100.7 KB，按 MB 会报成 1 MB。
  assert.equal(cacheSizeLabel(103_070), '101 KB')
  assert.equal(cacheSizeLabel(52_479), '51 KB')
})

test('1 MB 起按 MB 报，1 GB 起按 GB 报一位小数', () => {
  assert.equal(cacheSizeLabel(1024 ** 2), '1 MB')
  assert.equal(cacheSizeLabel(36 * 1024 ** 2), '36 MB')
  assert.equal(cacheSizeLabel(1024 ** 3), '1.0 GB')
  assert.equal(cacheSizeLabel(1.25 * 1024 ** 3), '1.3 GB')
})

test('两个边界之间不跳档', () => {
  assert.equal(cacheSizeLabel(1024 ** 2 - 1), '1024 KB')
  assert.equal(cacheSizeLabel(1024 ** 3 - 1), '1024 MB')
})
