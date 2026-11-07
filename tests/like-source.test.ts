import assert from 'node:assert/strict'
import test from 'node:test'
import { applyLiked, likeSourceOf } from '../src/features/favorites/like-source.ts'
import type { Track } from '../src/types.ts'

const track = (id: string, source?: string): Track =>
  ({
    id,
    title: id,
    artist: 'artist',
    album: 'album',
    duration: 180,
    path: `/music/${id}.flac`,
    ...(source ? { source } : {})
  }) as Track

/*
 * 「喜欢」落在哪里：本地文件写本机收藏，在线歌写平台账号。判断只依据歌的
 * source，不看它在哪个页面被点的——所以这里锁的是来源推断本身。
 */

test('没有 source 的歌算本机', () => {
  assert.equal(likeSourceOf(track('a')), 'local')
})

test('source 为 local 的歌算本机', () => {
  assert.equal(likeSourceOf(track('a', 'local')), 'local')
})

test('在线平台的歌用平台 id 当来源', () => {
  assert.equal(likeSourceOf(track('netease:123', 'netease')), 'netease')
  assert.equal(likeSourceOf(track('qq:abc', 'qq')), 'qq')
})

test('喜欢一首歌时把它放到最前面', () => {
  const rows = [track('a'), track('b')]
  const next = applyLiked(rows, track('c'), true)
  assert.deepEqual(next.map((row) => row.id), ['c', 'a', 'b'])
})

test('重复喜欢同一首不会留下两行', () => {
  const rows = [track('a'), track('b')]
  const next = applyLiked(rows, track('b'), true)
  assert.deepEqual(next.map((row) => row.id), ['b', 'a'])
  assert.equal(new Set(next.map((row) => row.id)).size, next.length)
})

test('取消喜欢只移除那一首，别的顺序不变', () => {
  const rows = [track('a'), track('b'), track('c')]
  const next = applyLiked(rows, track('b'), false)
  assert.deepEqual(next.map((row) => row.id), ['a', 'c'])
})

test('取消一首本来就不在列表里的歌不改变任何东西', () => {
  const rows = [track('a'), track('b')]
  const next = applyLiked(rows, track('z'), false)
  assert.deepEqual(next.map((row) => row.id), ['a', 'b'])
})

test('applyLiked 不改动传入的数组', () => {
  const rows = [track('a')]
  applyLiked(rows, track('b'), true)
  assert.deepEqual(rows.map((row) => row.id), ['a'])
})
