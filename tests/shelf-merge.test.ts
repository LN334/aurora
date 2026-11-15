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
  const eason = rows.find((row) => row.name === '陈奕迅')
  assert.deepEqual(eason?.providers, ['netease', 'qq'])
  const chenli = rows.find((row) => row.name === '陈粒')
  assert.deepEqual(chenli?.providers, ['netease'])
})

test('按名字排序：英文按字母、数字按大小', () => {
  const rows = mergeShelves([
    { name: 'Track 10', providerId: 'netease' as const },
    { name: 'banana', providerId: 'netease' as const },
    { name: 'Track 2', providerId: 'netease' as const },
    { name: 'Apple', providerId: 'netease' as const }
  ])
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Apple', 'banana', 'Track 2', 'Track 10']
  )
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

test('给了认领函数时，同名但不同歌手的专辑不算同一张', () => {
  const key = (album: { name: string; artistName: string }) =>
    normalizeTitle(album.name) + '|' + normalizeTitle(album.artistName)
  const rows = mergeShelves(
    [
      { name: '精选集', artistName: '周杰伦', providerId: 'netease' as const },
      { name: '精选集', artistName: '陈奕迅', providerId: 'qq' as const },
      { name: '精选集', artistName: '周杰伦', providerId: 'qq' as const }
    ],
    key
  )
  assert.equal(rows.length, 2)
  const jay = rows.find((row) => row.artistName === '周杰伦')
  assert.deepEqual(jay?.providers, ['netease', 'qq'])
})
