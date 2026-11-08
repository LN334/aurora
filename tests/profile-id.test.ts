import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROFILE, profileFileStem } from '../electron/pure/profile-id.ts'

test('a plain generated id passes through unchanged', () => {
  assert.equal(profileFileStem('acc_k3j9x2ab'), 'acc_k3j9x2ab')
})

test('an empty or missing id falls back to the default profile', () => {
  assert.equal(profileFileStem(null), DEFAULT_PROFILE)
  assert.equal(profileFileStem(undefined), DEFAULT_PROFILE)
  assert.equal(profileFileStem('   '), DEFAULT_PROFILE)
})

test('path separators and traversal cannot escape the profiles directory', () => {
  for (const hostile of ['../evil', 'a/b', '..\\evil', 'C:\\Windows']) {
    const stem = profileFileStem(hostile)
    assert.ok(!stem.includes('/'), stem)
    assert.ok(!stem.includes('\\'), stem)
    assert.ok(!stem.includes('..'), stem)
  }
})

test('two ids that clean to the same text keep distinct files', () => {
  assert.notEqual(profileFileStem('a/b'), profileFileStem('a_b'))
  assert.notEqual(profileFileStem('a b'), profileFileStem('a_b'))
})

test('a very long id is shortened but stays unique', () => {
  const long = 'x'.repeat(200)
  const stem = profileFileStem(long)
  assert.ok(stem.length <= 48 + 1 + 13, stem)
  assert.notEqual(stem, profileFileStem(long + 'y'))
})

test('the result is stable across calls', () => {
  assert.equal(profileFileStem('a/b'), profileFileStem('a/b'))
})
