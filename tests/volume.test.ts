import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MIN_AUDIBLE_VOLUME,
  RESTORE_VOLUME,
  WHEEL_STEP,
  volumeForUnmute,
  wheelVolume
} from '../src/features/player/volume.ts'

test('volumeForUnmute keeps a volume that is already audible', () => {
  assert.equal(volumeForUnmute(0.85), 0.85)
  assert.equal(volumeForUnmute(MIN_AUDIBLE_VOLUME), MIN_AUDIBLE_VOLUME)
})

test('volumeForUnmute lifts a silent volume so unmuting is not still silent', () => {
  assert.equal(volumeForUnmute(0), RESTORE_VOLUME)
  assert.equal(volumeForUnmute(0.01), RESTORE_VOLUME)
  assert.ok(RESTORE_VOLUME > MIN_AUDIBLE_VOLUME)
})

test('volumeForUnmute clamps an out-of-range value and survives garbage', () => {
  assert.equal(volumeForUnmute(4), 1)
  assert.equal(volumeForUnmute(Number.NaN), RESTORE_VOLUME)
})

test('wheelVolume moves one step in the wheel direction', () => {
  assert.equal(wheelVolume(0.5, 1), 0.55)
  assert.equal(wheelVolume(0.5, -1), 0.45)
  // 一次滚动常给 100/120 这样的大 delta，方向之外不参与计算。
  assert.equal(wheelVolume(0.5, 120), 0.5 + WHEEL_STEP)
})

test('wheelVolume clamps at both ends', () => {
  assert.equal(wheelVolume(0.98, 1), 1)
  assert.equal(wheelVolume(0.02, -1), 0)
  assert.equal(wheelVolume(0, -1), 0)
})
