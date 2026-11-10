import assert from 'node:assert/strict'
import test from 'node:test'
import { swapFadeMs } from '../src/features/player/crossfade.ts'

test('0 means hard cut, not a 190ms fade', () => {
  assert.equal(swapFadeMs(0), 0)
})

test('the number in the setting is the fade length, not just a switch', () => {
  assert.equal(swapFadeMs(1), 1000)
  assert.equal(swapFadeMs(3), 3000)
})

test('junk never reaches the audio clock', () => {
  assert.equal(swapFadeMs(-2), 0)
  assert.equal(swapFadeMs(Number.NaN), 0)
  assert.equal(swapFadeMs(Number.POSITIVE_INFINITY), 0)
})

test('an over-long value is clamped to the slider ceiling', () => {
  assert.equal(swapFadeMs(20), 6000)
})
