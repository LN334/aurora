import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterPlaylistRows } from '../src/features/library/playlist-filter.ts'

const tracks = [
  { title: '晚风', artist: '陈粒', album: '如也' },
  { title: '夜行', artist: '陈奕迅', album: 'The Key' },
  { title: '归途', artist: '李志', album: '1701' },
  { title: 'City of Stars', artist: 'Ryan Gosling', album: 'La La Land' }
]

test('空查询原样返回，下标连续', () => {
  const rows = filterPlaylistRows(tracks, '')
  assert.equal(rows.length, 4)
  assert.deepEqual(
    rows.map((row) => row.index),
    [0, 1, 2, 3]
  )
})

test('只留空白也算空查询', () => {
  assert.equal(filterPlaylistRows(tracks, '   ').length, 4)
})

test('筛出来的行带着它在歌单里的原始下标', () => {
  const rows = filterPlaylistRows(tracks, '陈')
  assert.deepEqual(
    rows.map((row) => row.track.title),
    ['晚风', '夜行']
  )
  // 关键是这两个数字：界面拿它播歌、移位置，不能是筛后的 0 与 1。
  assert.deepEqual(
    rows.map((row) => row.index),
    [0, 1]
  )
})

test('筛掉前面的行之后，后面的下标不跟着挪', () => {
  const rows = filterPlaylistRows(tracks, '归途')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].index, 2)
})

test('大小写不敏感，也能搜专辑与歌手', () => {
  assert.equal(filterPlaylistRows(tracks, 'city').length, 1)
  assert.equal(filterPlaylistRows(tracks, 'RyAN').length, 1)
  assert.equal(filterPlaylistRows(tracks, 'la la').length, 1)
})

test('多个词要同时命中', () => {
  assert.equal(filterPlaylistRows(tracks, '陈 奕迅').length, 1)
  assert.equal(filterPlaylistRows(tracks, '陈 李志').length, 0)
})

test('没有命中就是空数组', () => {
  assert.deepEqual(filterPlaylistRows(tracks, 'zzzz'), [])
})
