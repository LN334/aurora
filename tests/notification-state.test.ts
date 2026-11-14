import { test } from 'node:test'
import assert from 'node:assert/strict'

import { hidesOverlayForState, parseNotificationState } from '../electron/pure/notification-state.ts'

test('parses a plain state number', () => {
  assert.equal(parseNotificationState('5'), 5)
  assert.equal(parseNotificationState(' 2\r\n'), 2)
  assert.equal(parseNotificationState('0'), 0)
})

test('rejects anything that is not just digits', () => {
  assert.equal(parseNotificationState(''), null)
  assert.equal(parseNotificationState('  '), null)
  assert.equal(parseNotificationState('0 5'), null)
  assert.equal(parseNotificationState('state=5'), null)
  assert.equal(parseNotificationState('-1'), null)
})

test('hides for full-screen and presentation states', () => {
  assert.equal(hidesOverlayForState(2), true)
  assert.equal(hidesOverlayForState(3), true)
  assert.equal(hidesOverlayForState(4), true)
})

test('stays visible in the ordinary states', () => {
  for (const state of [0, 1, 5, 6, 7, 99]) {
    assert.equal(hidesOverlayForState(state), false, String(state))
  }
})
