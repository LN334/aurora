import assert from 'node:assert/strict'
import test from 'node:test'
import { decodePreset, encodePreset } from '../src/features/presets/codec.ts'

/**
 * 分享码是给人复制粘贴的，所以「能原样回来」和「垃圾串不炸」同样重要。
 * 这两条任何一条坏了，用户看到的都是「粘了没反应」。
 */

const SAMPLE = {
  name: '夜间低频',
  eqEnabled: true,
  gains: [6, 5, 3, 1, 0, -1, -2, 0, 1, 2],
  crossfadeSec: 0
}

test('a preset survives the round trip', () => {
  const restored = decodePreset(encodePreset(SAMPLE))
  assert.deepEqual(restored, SAMPLE)
})

test('the code is short enough to paste into a chat window', () => {
  const code = encodePreset(SAMPLE)
  assert.ok(code.startsWith('A1'))
  assert.ok(code.length < 160, 'code was ' + code.length + ' chars')
  // base64url 只该出现这三类字符，多一个都会在粘贴时被聊天软件转义
  assert.match(code, /^A1[A-Za-z0-9_-]+$/)
})

test('garbage is refused instead of decoded into nonsense', () => {
  for (const value of ['', 'A1', 'A1!!!!', 'B2abc', 'A1' + 'A'.repeat(4000), 'hello']) {
    assert.equal(decodePreset(value), null, JSON.stringify(value.slice(0, 12)) + ' should be refused')
  }
})

test('a curve with the wrong number of bands is refused', () => {
  const short = encodePreset({ ...SAMPLE, gains: [1, 2, 3] })
  assert.equal(decodePreset(short), null)
})

test('out-of-range gains are refused rather than clamped silently', () => {
  const wild = encodePreset({ ...SAMPLE, gains: [99, 0, 0, 0, 0, 0, 0, 0, 0, 0] })
  assert.equal(decodePreset(wild), null)
})
