import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NETEASE_QUALITIES, isNeteaseQuality, isUsableId } from '../electron/netease/types.ts'

/*
 * The guards that stand in front of every upstream call.
 *
 * They live in this module precisely so they can be tested: it is the one file
 * under `electron/netease/` that imports nothing at runtime (`client.ts` pulls
 * in Electron's `safeStorage` through `session.ts`, which a test runner cannot
 * load). That makes these the real implementations the IPC layer runs, not
 * copies.
 *
 * Why they matter: upstream answers a nonsense id with a 404 envelope that the
 * package *throws*. Without the guard, one search result with `artist.id === 0`
 * - which user-uploaded covers really do produce - takes down the whole panel
 * instead of returning an empty list.
 */

test('zero is rejected: it is a real id value upstream hands out for user uploads', () => {
  assert.equal(isUsableId(0), false)
})

test('negative, fractional and non-finite numbers are rejected', () => {
  for (const id of [-1, -6452, 1.5, -0.0001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(isUsableId(id), false, `${id} should not be usable`)
  }
})

test('an id past the safe-integer range is rejected, because it cannot round-trip as itself', () => {
  // `Number.isInteger` would say true for 2^53, and forwarding it would earn
  // exactly the 404 envelope this guard exists to prevent: the number does not
  // survive the JSON trip to upstream unchanged. The guard was integer-based
  // when this test was first written; it is now safe-integer-based, and this
  // case is what makes the difference visible.
  assert.equal(isUsableId(Number.MAX_SAFE_INTEGER), true)
  assert.equal(isUsableId(Number.MAX_SAFE_INTEGER + 1), false)
  assert.equal(isUsableId(Number.MAX_SAFE_INTEGER + 2), false)
  assert.equal(isUsableId(Number.MAX_VALUE), false)
  // A large but still exact integer is fine, so the guard is not just refusing
  // big numbers.
  assert.equal(isUsableId(1e15), true)
  // And a value that cannot be an integer at all is still rejected.
  assert.equal(isUsableId(1e15 + 0.5), false)
})

test('real ids are accepted', () => {
  for (const id of [1, 2, 6452, 186016, 2668397359, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isUsableId(id), true, `${id} should be usable`)
  }
})

test('a numeric string is not an id: the guard does not coerce', () => {
  // The IPC layer validates the wire shape before this runs, so something that
  // arrived as a string is a caller bug and must be refused, not converted.
  assert.equal(isUsableId('1' as unknown as number), false)
  assert.equal(isUsableId('186016' as unknown as number), false)
})

test('null, undefined and objects are not ids', () => {
  for (const value of [null, undefined, {}, [], true]) {
    assert.equal(isUsableId(value as unknown as number), false, `${String(value)} should not be usable`)
  }
})

test('the quality guard accepts every selectable tier, worst to best', () => {
  /*
   * 后四档是无损之上：Hi-Res、高清环绕声、沉浸环绕声、超清母带。实测同一首
   * 歌（夜に駆ける）在 128k/192k/320k/无损之外还能给 jyeffect 3.1M、sky 2.4M、
   * jymaster 5.2M 的 FLAC；`hires` 这首歌没有，上游会回落成 lossless。
   */
  assert.deepEqual([...NETEASE_QUALITIES], [
    'standard',
    'higher',
    'exhigh',
    'lossless',
    'hires',
    'jyeffect',
    'sky',
    'jymaster'
  ])
  for (const quality of NETEASE_QUALITIES) assert.equal(isNeteaseQuality(quality), true)
})

test('the quality guard accepts hires as a request, not only as a report', () => {
  // 以前 `hires` 只出现在回包里、设置里选不到；现在它是可选档之一。
  assert.equal(isNeteaseQuality('hires'), true)
})

test('the quality guard refuses anything that is not one of the strings', () => {
  for (const value of ['', 'EXHIGH', 'loss', 'standard ', 'master', 'spatial', 1, null, undefined, {}, ['exhigh']]) {
    assert.equal(isNeteaseQuality(value), false, `${String(value)} should not pass the quality guard`)
  }
})
