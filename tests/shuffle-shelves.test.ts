import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shuffleWithSeed } from '../src/features/online/shuffle.ts'

const pool = Array.from({ length: 20 }, (_, i) => i)

test('同一种子洗出同一顺序', () => {
  assert.deepEqual(shuffleWithSeed(pool, 3), shuffleWithSeed(pool, 3))
})

test('不同种子给出不同顺序', () => {
  assert.notDeepEqual(shuffleWithSeed(pool, 3), shuffleWithSeed(pool, 4))
})

test('洗牌不增删元素', () => {
  assert.deepEqual(shuffleWithSeed(pool, 9).slice().sort((a, b) => a - b), pool)
})

test('空列表与单元素安全', () => {
  assert.deepEqual(shuffleWithSeed([], 1), [])
  assert.deepEqual(shuffleWithSeed([7], 1), [7])
})
