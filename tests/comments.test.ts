import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asCount, asList, asObject, asSeconds, asText, emptyPage } from '../electron/comments.ts'

test('asObject only accepts a plain object', () => {
  assert.deepEqual(asObject({ a: 1 }), { a: 1 })
  assert.deepEqual(asObject([1, 2]), {})
  assert.deepEqual(asObject(null), {})
  assert.deepEqual(asObject('x'), {})
})

test('asList only accepts an array', () => {
  assert.deepEqual(asList([1]), [1])
  assert.deepEqual(asList({ 0: 1 }), [])
  assert.deepEqual(asList(undefined), [])
})

test('asText trims strings and ignores everything else', () => {
  assert.equal(asText('  hi  '), 'hi')
  assert.equal(asText(12), '')
  assert.equal(asText(null), '')
})

test('asCount floors junk to zero and rounds a real count', () => {
  assert.equal(asCount(12.6), 13)
  assert.equal(asCount(0), 0)
  assert.equal(asCount(-3), 0)
  assert.equal(asCount('12'), 0)
  assert.equal(asCount(Number.NaN), 0)
})

test('asSeconds reads seconds, milliseconds and numeric strings', () => {
  assert.equal(asSeconds(1700000000), 1700000000)
  assert.equal(asSeconds(1700000000123), 1700000000)
  assert.equal(asSeconds('1700000000'), 1700000000)
  assert.equal(asSeconds(' 1700000000 '), 1700000000)
})

test('asSeconds reads kugou date strings as Beijing time', () => {
  // 2024-04-30 07:29:18 +08:00
  assert.equal(asSeconds('2024-04-30 07:29:18'), 1714433358)
  assert.equal(asSeconds('2024-04-30T07:29:18'), 1714433358)
})

test('asSeconds rejects emptiness, junk and non-positive values', () => {
  assert.equal(asSeconds(0), null)
  assert.equal(asSeconds(-5), null)
  assert.equal(asSeconds(''), null)
  assert.equal(asSeconds('yesterday'), null)
  assert.equal(asSeconds('2024-04-30'), null)
  assert.equal(asSeconds(null), null)
})

test('emptyPage is an empty page that claims no total', () => {
  assert.deepEqual(emptyPage(), { comments: [], total: null, hasMore: false, cursor: '' })
})
