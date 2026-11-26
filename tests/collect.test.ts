import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../src/types.ts'
import type { OnlineMusicProvider } from '../src/features/online/types.ts'
import { collectTracks } from '../src/features/online/collect.ts'

/** 一件够用的假曲目：合并只看标题、艺人、时长与来源。 */
function track(id: string, source: string, extra: Partial<Track> = {}): Track {
  return {
    id,
    title: '同一首歌',
    artist: '同一个人',
    album: '同一张',
    duration: 200,
    source,
    ...extra
  } as Track
}

function provider(id: string, backend: unknown): OnlineMusicProvider {
  return {
    id,
    displayName: id,
    summary: '',
    disclosure: '',
    anonymousNote: '',
    capabilities: {},
    available: () => true,
    backend
  } as unknown as OnlineMusicProvider
}

test('两家分别问，回来的并成一行', async () => {
  const out = await collectTracks(
    [provider('netease', { toTrack: (s: Track) => s }), provider('qq', { toTrack: (s: Track) => s })],
    ['netease', 'qq'],
    async (p) => [track(p.id + ':1', p.id)]
  )
  assert.equal(out.length, 1)
  assert.equal(out[0]?.source, 'netease')
  assert.equal(out[0]?.versions?.length, 1)
})

test('一家抛错，另外几家照给', async () => {
  const out = await collectTracks(
    [provider('netease', {}), provider('qq', {})],
    ['netease', 'qq'],
    async (p) => {
      if (p.id === 'netease') throw new Error('上游挂了')
      return [track('qq:2', 'qq')]
    }
  )
  assert.equal(out.length, 1)
  assert.equal(out[0]?.source, 'qq')
})

test('没有 backend 的那家不问', async () => {
  let asked = 0
  const out = await collectTracks(
    [provider('netease', undefined), provider('qq', {})],
    ['netease', 'qq'],
    async () => {
      asked += 1
      return [track('qq:3', 'qq')]
    }
  )
  assert.equal(asked, 1)
  assert.equal(out.length, 1)
})

test('一家都不问就空，不碰回调', async () => {
  let asked = 0
  const out = await collectTracks([], ['netease'], async () => {
    asked += 1
    return []
  })
  assert.deepEqual(out, [])
  assert.equal(asked, 0)
})

test('顺序决定哪一版当主行', async () => {
  const out = await collectTracks(
    [provider('netease', {}), provider('qq', {})],
    ['qq', 'netease'],
    async (p) => [track(p.id + ':9', p.id)]
  )
  assert.equal(out.length, 1)
  assert.equal(out[0]?.source, 'qq')
})
