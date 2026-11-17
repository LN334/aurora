import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LIKED_FAIL_TTL,
  LIKED_TTL,
  foldLikedParts,
  likedCacheTtl,
  likedCountLabel,
  likedReadFailed
} from '../src/features/online/liked-merge.ts'
import type { Track } from '../src/types.ts'

function track(id: string): Track {
  return {
    id,
    path: id,
    title: id,
    artist: '',
    albumArtist: '',
    album: '',
    genre: '',
    year: null,
    trackNo: null,
    discNo: null,
    duration: 0,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: '',
    lossless: false,
    size: 0,
    mtimeMs: 0,
    addedAt: 0,
    hasArt: false
  }
}

test('四家都读到：条数相加，没失败', () => {
  const fold = foldLikedParts([
    { tracks: [track('a'), track('b')], failed: false },
    { tracks: [track('c')], failed: false }
  ])
  assert.equal(fold.tracks.length, 3)
  assert.equal(fold.failed, 0)
})

test('一家没问出来：别家的歌照样返回', () => {
  const fold = foldLikedParts([
    { tracks: [track('a')], failed: false },
    { tracks: [], failed: true }
  ])
  assert.deepEqual(
    fold.tracks.map((item) => item.id),
    ['a']
  )
  assert.equal(fold.failed, 1)
})

test('全都没问出来：是失败，不是「一首都没有」', () => {
  const fold = foldLikedParts([
    { tracks: [], failed: true },
    { tracks: [], failed: true }
  ])
  assert.equal(fold.tracks.length, 0)
  assert.equal(fold.failed, 2)
})

test('失败那份缓存只活三十秒，别把一次 502 冻十分钟', () => {
  assert.equal(likedCacheTtl(0), LIKED_TTL)
  assert.equal(likedCacheTtl(1), LIKED_FAIL_TTL)
  assert.ok(LIKED_FAIL_TTL < LIKED_TTL)
})

test('读完了有歌：卡片印条数', () => {
  assert.equal(likedCountLabel(true, 636, 0), '636 首')
})

test('读完了确实一首没有：才印 0 首', () => {
  assert.equal(likedCountLabel(true, 0, 0), '0 首')
})

test('有平台没应答又一条没读到：印「未读到」，不印 0 首', () => {
  assert.equal(likedCountLabel(true, 0, 2), '未读到')
  assert.equal(likedReadFailed(0, 2), true)
})

test('还有别家读到了歌：失败数不影响条数', () => {
  assert.equal(likedCountLabel(true, 12, 1), '12 首')
  assert.equal(likedReadFailed(12, 1), false)
})

test('还没读完：印破折号，不宣布任何结果', () => {
  assert.equal(likedCountLabel(false, 0, 0), '—')
})
