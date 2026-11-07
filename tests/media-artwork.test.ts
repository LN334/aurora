import assert from 'node:assert/strict'
import test from 'node:test'
import { COVER_MAX_SIZE, COVER_QUALITY, squareCrop } from '../src/features/player/artwork.ts'

test('squareCrop takes the largest centred square out of a wide cover', () => {
  assert.deepEqual(squareCrop(1200, 800), { sx: 200, sy: 0, size: 800 })
})

test('squareCrop takes the largest centred square out of a tall cover', () => {
  assert.deepEqual(squareCrop(600, 900), { sx: 0, sy: 150, size: 600 })
})

test('squareCrop leaves a square cover alone', () => {
  assert.deepEqual(squareCrop(500, 500), { sx: 0, sy: 0, size: 500 })
})

test('squareCrop refuses a broken size instead of inventing one', () => {
  assert.deepEqual(squareCrop(0, 0), { sx: 0, sy: 0, size: 0 })
  assert.deepEqual(squareCrop(-10, 20), { sx: 0, sy: 0, size: 0 })
  assert.deepEqual(squareCrop(Number.NaN, 5), { sx: 0, sy: 0, size: 0 })
  assert.deepEqual(squareCrop(10, Number.POSITIVE_INFINITY), { sx: 0, sy: 0, size: 0 })
})

test('the encoded cover is big enough for the media card and small enough to embed', () => {
  assert.ok(COVER_MAX_SIZE >= 256 && COVER_MAX_SIZE <= 1024)
  assert.ok(COVER_QUALITY > 0.5 && COVER_QUALITY <= 0.95)
})
