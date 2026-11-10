import assert from 'node:assert/strict'
import test from 'node:test'
import { interleaveBySource, rotateBySeed } from '../src/features/library/daily.ts'
import type { Track } from '../src/types.ts'

function track(id: number, source = 'netease'): Track {
  return {
    id: String(id),
    title: 'song ' + id,
    artist: 'artist',
    album: 'album',
    duration: 200,
    source,
    codec: 'mp3',
    lossless: false,
    path: ''
  } as unknown as Track
}

const pool = Array.from({ length: 30 }, (_, index) => track(index))

test('同一天同一个种子给出同一个顺序', () => {
  assert.deepEqual(
    rotateBySeed(pool, '2026-11-10').map((item) => item.id),
    rotateBySeed(pool, '2026-11-10').map((item) => item.id)
  )
})

test('换个日子首曲就换人', () => {
  const days = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']
  const firsts = new Set(days.map((day) => rotateBySeed(pool, day)[0].id))
  assert.ok(firsts.size > 1, '四天给出同一个首曲，等于没轮转')
})

test('只挪起点，不多不少', () => {
  const out = rotateBySeed(pool, '2026-11-10')
  assert.equal(out.length, pool.length)
  assert.deepEqual(
    out.map((item) => item.id).sort(),
    pool.map((item) => item.id).sort()
  )
  const at = pool.findIndex((item) => item.id === out[0].id)
  assert.deepEqual(
    out.map((item) => item.id),
    [...pool.slice(at), ...pool.slice(0, at)].map((item) => item.id)
  )
})

test('交错仍然是一家一首轮流', () => {
  const rows = [
    ...Array.from({ length: 3 }, (_, index) => track(index, 'netease')),
    ...Array.from({ length: 3 }, (_, index) => track(10 + index, 'qq')),
    ...Array.from({ length: 3 }, (_, index) => track(20 + index, 'kugou'))
  ]
  assert.deepEqual(
    interleaveBySource(rows).map((item) => item.source),
    ['netease', 'qq', 'kugou', 'netease', 'qq', 'kugou', 'netease', 'qq', 'kugou']
  )
})
