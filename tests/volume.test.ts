import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KEY_STEP,
  MIN_AUDIBLE_VOLUME,
  RESTORE_VOLUME,
  WHEEL_STEP,
  stepVolume,
  volumeForUnmute,
  volumeIntentChanged,
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

test('wheelVolume moves one percent per notch', () => {
  assert.equal(WHEEL_STEP, 0.01)
  assert.equal(wheelVolume(0.5, 1), 0.5 + WHEEL_STEP)
  assert.equal(wheelVolume(0.5, -1), 0.5 - WHEEL_STEP)
  // 一次滚动常给 100/120 这样的大 delta，方向之外不参与计算。
  assert.equal(wheelVolume(0.5, 120), 0.5 + WHEEL_STEP)
})

test('wheelVolume clamps at both ends', () => {
  assert.equal(wheelVolume(0.995, 1), 1)
  assert.equal(wheelVolume(0.005, -1), 0)
  assert.equal(wheelVolume(0, -1), 0)
})

test('stepVolume walks a fixed step, default five percent', () => {
  assert.equal(KEY_STEP, 0.05)
  assert.equal(stepVolume(0.5, 1), 0.55)
  assert.equal(stepVolume(0.5, -1), 0.45)
  assert.equal(stepVolume(0.5, 1, 0.2), 0.7)
  assert.equal(stepVolume(0.9, 1, 0.2), 1)
  assert.equal(stepVolume(0.1, -1, 0.2), 0)
})

test('volumeIntentChanged reacts to the two fields the gain depends on', () => {
  assert.equal(volumeIntentChanged({ volume: 0.5, muted: false }, { volume: 0.6, muted: false }), true)
  assert.equal(volumeIntentChanged({ volume: 0.5, muted: false }, { volume: 0.5, muted: true }), true)
  assert.equal(volumeIntentChanged({ volume: 0, muted: true }, { volume: 0, muted: false }), true)
})

test('volumeIntentChanged stays quiet while the queue or the clock moves', () => {
  assert.equal(volumeIntentChanged({ volume: 0.5, muted: false }, { volume: 0.5, muted: false }), false)
})
