import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTaste, primaryArtist, tastefulDaily } from '../src/features/library/taste.ts'
import { dailyTracks } from '../src/features/library/daily.ts'
import type { Track } from '../src/types.ts'

function track(id: number, artist: string, source: string | undefined = 'netease'): Track {
  return {
    id: String(id),
    title: 'song ' + id,
    artist,
    album: 'album',
    duration: 200,
    source,
    codec: 'mp3',
    lossless: false,
    path: ''
  } as unknown as Track
}

const day = new Date('2026-11-08T10:00:00+08:00')

test('没有画像时行为和日期哈希完全一样', () => {
  const pool = Array.from({ length: 40 }, (_, index) => track(index, index % 4 === 0 ? 'A' : 'B' + index))
  const profile = buildTaste({ recent: [], liked: [], days: [] })
  assert.equal(profile.size, 0)
  assert.deepEqual(
    dailyTracks(pool, day, 10, profile).map((item) => item.id),
    dailyTracks(pool, day, 10).map((item) => item.id)
  )
})

test('常听的人排到最前面，但一个艺人最多两首', () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, index) => track(index, 'A')),
    ...Array.from({ length: 30 }, (_, index) => track(100 + index, 'B' + index))
  ]
  const profile = buildTaste({
    recent: Array.from({ length: 20 }, () => ({ track: track(1, 'A') })),
    liked: [track(1, 'A')],
    days: [{ artists: { A: 3600 * 8 } }]
  })
  assert.ok(profile.size > 0)
  assert.equal(profile.artists['a'], 1)
  const picked = tastefulDaily(pool, profile, day, 20)
  assert.equal(picked.length, 20)
  const firstTwo = picked.slice(0, 2).filter((item) => item.artist === 'A')
  assert.ok(firstTwo.length >= 1, '常听艺人应该在开头')
  assert.ok(picked.filter((item) => item.artist === 'A').length <= 2, '一个艺人不超过两首')
})

test('同一天同一批，换一天换一批', () => {
  const pool = Array.from({ length: 40 }, (_, index) => track(index, 'artist ' + index))
  const profile = buildTaste({
    recent: [{ track: track(3, 'artist 3') }, { track: track(7, 'artist 7') }],
    liked: [],
    days: []
  })
  const once = tastefulDaily(pool, profile, day, 12).map((item) => item.id)
  const twice = tastefulDaily(pool, profile, day, 12).map((item) => item.id)
  assert.deepEqual(once, twice)
  const tomorrow = tastefulDaily(pool, profile, new Date(day.getTime() + 86400000), 12).map((item) => item.id)
  assert.notDeepEqual(once, tomorrow)
})

test('池子只有一个人的歌时，宁可放宽上限也要凑够', () => {
  const pool = Array.from({ length: 6 }, (_, index) => track(index, 'solo'))
  const profile = buildTaste({ recent: [], liked: [track(0, 'solo')], days: [] })
  const picked = tastefulDaily(pool, profile, day, 6)
  assert.equal(picked.length, 6)
})

test('主艺人只取第一个名字', () => {
  assert.equal(primaryArtist('周乘羽 / 卡力老虎'), '周乘羽')
  assert.equal(primaryArtist('A feat. B'), 'a')
  assert.equal(primaryArtist('  GAI周延 、 等一下就回家 '), 'gai周延')
})
