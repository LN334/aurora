import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendFresh,
  rankBySeed,
  remainingSeconds,
  roamProgress,
  shouldPullMore,
  withoutTrack
} from '../src/features/player/roam-pure.ts'
import { trackKey } from '../src/features/online/unify.ts'
import type { Track } from '../src/types.ts'

/** 拼一首够用的曲子：这几条算术只认标题、主艺人与时长。 */
function track(id: string, title: string, duration = 200, artist = '某人', album = ''): Track {
  return {
    id,
    path: id,
    title,
    artist,
    albumArtist: artist,
    album,
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

test('remainingSeconds 只算当前之后，时长不认就按 0', () => {
  const long = track('l', '长', 480)
  const noMeta = track('n', '没时长', 0)
  assert.equal(remainingSeconds([a, b, long], 0), 200 + 480)
  assert.equal(remainingSeconds([a, b, long], 2), 0)
  assert.equal(remainingSeconds([a, noMeta], 0), 0)
})

test('rankBySeed 排成 同专辑 > 同艺人 > 同名 > 其他，种子排第一', () => {
  const seed = track('s', '孤山春', 200, '白景屹', '孤山')
  const sameAlbum = track('al', '山风', 200, '白景屹', '孤山')
  const sameArtist = track('ar', '别的歌', 200, '白景屹', '另一张')
  const sameTitle = track('ti', '孤山春', 200, '翻唱的人', '合辑')
  const other = track('ot', '无关', 200, '别人', '别的')
  const ranked = rankBySeed([other, sameArtist, seed, sameTitle, sameAlbum], seed)
  assert.deepEqual(
    ranked.map((item) => item.id),
    ['s', 'al', 'ar', 'ti', 'ot']
  )
})

test('rankBySeed 同一档里保持传进来的先后，不偷偷重排', () => {
  const seed = track('s', '甲', 200, '某人', '专辑')
  const first = track('f', '乙', 200, '某人', '专辑')
  const second = track('g', '丙', 200, '某人', '专辑')
  // 种子不在传进来的列表里时，这几个纯排序也不该把它塞回去——插种子是取数层的活。
  const ranked = rankBySeed([second, first], seed)
  assert.deepEqual(
    ranked.map((item) => item.id),
    ['g', 'f']
  )
})

test('rankBySeed 同曲的另一个平台版本也算种子', () => {
  // trackKey 只看标题、主艺人与时长，所以 QQ 那一份与网易云那份是同一首。
  const seed = track('s', '孤山春', 200, '白景屹', '孤山')
  const twin = track('s-qq', '孤山春', 200, '白景屹', '孤山')
  const other = track('o', '无关', 200, '别人', '别的')
  assert.deepEqual(
    rankBySeed([other, twin], seed).map((item) => item.id),
    ['s-qq', 'o']
  )
})

test('remainingSeconds 位次不在列表里返回 0', () => {
  assert.equal(remainingSeconds([a, b], -1), 0)
  assert.equal(remainingSeconds([], 0), 0)
})
