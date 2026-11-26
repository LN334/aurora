import test from 'node:test'
import assert from 'node:assert/strict'
import { isTrackLiked } from '../src/features/favorites/liked-pure.ts'
import type { Track } from '../src/types.ts'

function track(id: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    title: 't',
    artist: 'a',
    album: '',
    duration: 200,
    source: 'netease',
    path: '',
    ...extra
  } as Track
}

test('没有歌就是没喜欢', () => {
  const ids = new Set(['x'])
  assert.equal(isTrackLiked(null, ids), false)
  assert.equal(isTrackLiked(undefined, ids), false)
})

test('主行在集合里就是喜欢', () => {
  const ids = new Set(['netease:1'])
  assert.equal(isTrackLiked(track('netease:1'), ids), true)
})

test('主行不在、但挂着的另一家版本在，也算喜欢', () => {
  const ids = new Set(['qq:99'])
  const head = track('netease:1', { versions: [track('qq:99', { source: 'qq' })] })
  assert.equal(isTrackLiked(head, ids), true)
})

test('主行和所有版本都不在，才算没喜欢', () => {
  const ids = new Set(['kugou:7'])
  const head = track('netease:1', { versions: [track('qq:99', { source: 'qq' })] })
  assert.equal(isTrackLiked(head, ids), false)
})

test('空集合，怎么都不亮', () => {
  const head = track('netease:1', { versions: [track('qq:99', { source: 'qq' })] })
  assert.equal(isTrackLiked(head, new Set()), false)
})
