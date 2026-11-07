import assert from 'node:assert/strict'
import { test } from 'node:test'
import { durationBucket, mergeVersions, primaryArtist, sourcesOf, trackKey } from '../src/features/online/unify.ts'
import type { Track } from '../src/types.ts'

/*
 * 这些断言守的是「同一首歌到底算不算同一首」。
 *
 * 并错方向的代价不对称：把两首并成一首，用户点播放会听见另一首歌；把一首拆成
 * 两行，只是列表多一行。所以规则只认全等（标题 + 主艺人 + 时长档），下面的用例
 * 一半在证明它该合的合，一半在证明它不该合的绝不合。
 */

function track(over: Partial<Track> & { title: string }): Track {
  return {
    id: over.id ?? `${over.source ?? 'local'}:${over.title}`,
    path: over.id ?? over.title,
    source: over.source ?? 'local',
    artist: over.artist ?? '陈默',
    album: over.album ?? '夜行列车',
    duration: over.duration ?? 200,
    ...over
  } as Track
}

test('标题里的 feat. 段不参与比较', () => {
  const a = track({ title: 'Hong Kong (feat. 王菲季候风)', source: 'netease' })
  const b = track({ title: 'Hong Kong', source: 'qq' })
  assert.equal(trackKey(a), trackKey(b))
})

test('全角与大小写差异不拆行', () => {
  const a = track({ title: 'ＢＬＵＥ', artist: 'The Weeknd', source: 'netease' })
  const b = track({ title: 'blue', artist: 'the  weeknd', source: 'qq' })
  assert.equal(trackKey(a), trackKey(b))
})

test('主艺人只比第一个：合唱顺序不同仍算同一首', () => {
  const a = track({ title: 'Secrets', artist: 'The Weeknd / Lana Del Rey' })
  const b = track({ title: 'Secrets', artist: 'Lana Del Rey / The Weeknd' })
  assert.notEqual(trackKey(a), trackKey(b))
  assert.equal(primaryArtist(a.artist), 'the weeknd')
})

test('时长差 2 秒内合并，差 30 秒不合并', () => {
  const a = track({ title: 'Starboy', source: 'netease', duration: 230 })
  const b = track({ title: 'Starboy', source: 'qq', duration: 231 })
  assert.equal(trackKey(a), trackKey(b))
  const live = track({ title: 'Starboy', source: 'qq', duration: 260 })
  assert.notEqual(trackKey(a), trackKey(live))
})

test('时长 0 不与已知时长合并', () => {
  assert.equal(durationBucket(0), 0)
  assert.notEqual(durationBucket(0), durationBucket(200))
})

test('合并后主行按音源优先级排序，其余挂 versions', () => {
  const ne = track({ title: '晴天', source: 'netease', onlineId: 1, duration: 269 })
  const qq = track({ title: '晴天', source: 'qq', onlineId: 2, duration: 269 })
  const local = track({ title: '晴天', source: 'local', duration: 269 })

  const merged = mergeVersions([ne, qq, local])
  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.source, 'local')
  assert.deepEqual(merged[0]?.versions?.map((item) => item.source), ['netease', 'qq'])

  const byUser = mergeVersions([ne, qq, local], ['qq', 'netease', 'local'])
  assert.equal(byUser[0]?.source, 'qq')
})

test('同一平台的两个同一首歌只留一个版本', () => {
  const a = track({ title: '晴天', source: 'netease', onlineId: 1 })
  const b = track({ title: '晴天', source: 'netease', onlineId: 1, id: 'netease:1' })
  const merged = mergeVersions([a, b])
  assert.equal(merged[0]?.versions?.length ?? 0, 0)
})

test('sourcesOf 返回去重后的平台，按优先级排列', () => {
  const ne = track({ title: '晴天', source: 'netease', onlineId: 1 })
  const qq = track({ title: '晴天', source: 'qq', onlineId: 2 })
  const merged = mergeVersions([ne, qq])
  assert.deepEqual(sourcesOf(merged[0] as Track), ['netease', 'qq'])
})
