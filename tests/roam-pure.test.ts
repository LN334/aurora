import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFresh, roamProgress, shouldPullMore, withoutTrack } from '../src/features/player/roam-pure.ts'
import { trackKey } from '../src/features/online/unify.ts'
import type { Track } from '../src/types.ts'

/** 拼一首够用的曲子：这几条算术只认标题、主艺人与时长。 */
function track(id: string, title: string, duration = 200, artist = '某人'): Track {
  return {
    id,
    path: id,
    title,
    artist,
    albumArtist: artist,
    album: '',
    genre: '',
    year: null,
    trackNo: null,
    discNo: null,
    duration,
    bitrate: null,
    sampleRate: null,
    channels: null,
    codec: '',
    lossless: false,
    size: 0,
    mtimeMs: 0,
    addedAt: 0,
    hasArt: false,
    gainDb: null,
    peak: null
  }
}

const a = track('a', '甲')
const b = track('b', '乙')
const c = track('c', '丙')
const d = track('d', '丁')

test('roamProgress 算当前位次、已听与后面还剩多少', () => {
  const progress = roamProgress([a, b, c, d], c, new Set([trackKey(a), trackKey(b)]))
  assert.equal(progress.index, 2)
  assert.equal(progress.total, 4)
  assert.equal(progress.heard, 2)
  assert.equal(progress.ahead, 1)
})

test('roamProgress 当前不在这一趟时指数是 -1，后面还剩全部', () => {
  const progress = roamProgress([a, b], track('x', '别的'), new Set())
  assert.equal(progress.index, -1)
  assert.equal(progress.heard, 0)
  assert.equal(progress.ahead, 2)
})

test('roamProgress 没有当前曲时也安全', () => {
  const progress = roamProgress([a], null, new Set())
  assert.equal(progress.index, -1)
  assert.equal(progress.ahead, 1)
})

test('appendFresh 去掉已有、划掉与批内重复，保留原顺序', () => {
  // 同标题同主艺人同时长档 = 同一首，哪怕 id 不同（另一个平台的版本）。
  const again = track('a-qq', '甲')
  const fresh = appendFresh([a, b], [again, c, d, track('d2', '丁')], new Set([trackKey(c)]))
  assert.deepEqual(
    fresh.map((item) => item.id),
    ['d']
  )
})

test('appendFresh 全是重复时返回空数组', () => {
  assert.deepEqual(appendFresh([a], [track('a2', '甲')], new Set()), [])
})

test('withoutTrack 摘掉的是同一首歌的所有版本', () => {
  const rest = withoutTrack([a, track('a-qq', '甲'), b], a)
  assert.deepEqual(
    rest.map((item) => item.id),
    ['b']
  )
})

test('withoutTrack 找不到时原样返回', () => {
  assert.deepEqual(withoutTrack([a, b], c), [a, b])
})

test('shouldPullMore 后面剩得不多就要补，负数也照补', () => {
  // left 是当前之后还有几首：0 = 正在最后一首，-1 = 已经不在这一趟里。
  for (const left of [6, 2, 0, -1]) assert.equal(shouldPullMore(left, 6), true)
})

test('shouldPullMore 后面的还够听一段就不补，免得白白要歌', () => {
  assert.equal(shouldPullMore(7, 6), false)
  assert.equal(shouldPullMore(58, 6), false)
})
