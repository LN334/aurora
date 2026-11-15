import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeShelves, normalizeTitle } from '../src/features/online/shelf-merge.ts'

test('同名合并成一行，平台按出现顺序收集', () => {
  const rows = mergeShelves([
    { name: '陈奕迅', providerId: 'netease' as const },
    { name: '陈奕迅', providerId: 'qq' as const },
    { name: '陈粒', providerId: 'netease' as const }
  ])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].providers, ['netease', 'qq'])
  assert.deepEqual(rows[1].providers, ['netease'])
})

test('同一家重复出现不重复收集平台', () => {
  const rows = mergeShelves([
    { name: '夜航', providerId: 'netease' as const },
    { name: '夜航', providerId: 'netease' as const }
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].providers, ['netease'])
})

test('只差空白与大小写的名字算同一张', () => {
  const rows = mergeShelves([
    { name: 'Sour', providerId: 'netease' as const },
    { name: ' sour ', providerId: 'qq' as const },
    { name: 'SOUR', providerId: 'kugou' as const }
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].providers, ['netease', 'qq', 'kugou'])
})

test('不同名字不会被合并', () => {
  const rows = mergeShelves([
    { name: '夜', providerId: 'netease' as const },
    { name: '夜色', providerId: 'qq' as const }
  ])
  assert.equal(rows.length, 2)
})

test('空列表返回空，归一化只去空白与大小写', () => {
  assert.deepEqual(mergeShelves([]), [])
  assert.equal(normalizeTitle('  A  b '), 'ab')
})
