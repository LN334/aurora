import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_SAVED,
  isSameCurve,
  nextName,
  withPreset,
  withoutPreset,
  type SavedPreset
} from '../src/features/presets/saved.ts'

const FLAT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

function preset(id: string, at: number, gains = FLAT, eqEnabled = true, name = id): SavedPreset {
  return { id, name, eqEnabled, gains, at }
}

test('the first saved preset is numbered 1', () => {
  assert.equal(nextName([]), '我的预设 1')
})

test('a number already taken is skipped instead of duplicated', () => {
  const list = [preset('a', 1, FLAT, true, '我的预设 1'), preset('b', 2, FLAT, true, '我的预设 3')]
  assert.equal(nextName(list), '我的预设 2')
})

test('saving one more keeps the list in order and the new one last', () => {
  const list = [preset('a', 1), preset('b', 2)]
  const next = withPreset(list, preset('c', 3))
  assert.deepEqual(next.map((item) => item.id), ['a', 'b', 'c'])
})

test('past the cap the oldest is dropped, never the new one', () => {
  const list = Array.from({ length: MAX_SAVED }, (_, i) => preset('p' + i, i))
  const fresh = preset('new', 9_999)
  const next = withPreset(list, fresh)
  assert.equal(next.length, MAX_SAVED)
  assert.equal(next[next.length - 1]?.id, 'new', 'the preset just saved must survive')
  assert.ok(!next.some((item) => item.id === 'p0'), 'the oldest one is the one that goes')
})

test('removing takes exactly one id and leaves the rest alone', () => {
  const list = [preset('a', 1), preset('b', 2), preset('c', 3)]
  assert.deepEqual(withoutPreset(list, 'b').map((item) => item.id), ['a', 'c'])
  assert.deepEqual(withoutPreset(list, 'nope').map((item) => item.id), ['a', 'b', 'c'])
})

test('the same curve with the same switch reads as the active preset', () => {
  const curve = [6, 5, 3, 1, 0, 0, 0, 0, 0, 0]
  assert.equal(isSameCurve(preset('a', 1, curve), curve, true), true)
})

test('one band off is not the same curve', () => {
  const curve = [6, 5, 3, 1, 0, 0, 0, 0, 0, 0]
  assert.equal(isSameCurve(preset('a', 1, curve), [6, 5, 3, 0, 0, 0, 0, 0, 0, 0], true), false)
})

test('a curve saved while the equaliser was off is not the active one when it is on', () => {
  assert.equal(isSameCurve(preset('a', 1, FLAT, false), FLAT, true), false)
})

test('a preset from an older band layout is never "the same"', () => {
  assert.equal(isSameCurve(preset('a', 1, [1, 2, 3]), FLAT, true), false)
})
