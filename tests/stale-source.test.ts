import assert from 'node:assert/strict'
import test from 'node:test'
import { STALE_SOURCE_MS, sourceIsStale } from '../src/features/player/stale-source.ts'

const now = 1_700_000_000_000

test('a local file never goes stale, however long its url has been loaded', () => {
  assert.equal(sourceIsStale(false, now, now + 365 * 24 * 3600 * 1000), false)
})

test('an online source is still trusted just short of the window', () => {
  assert.equal(sourceIsStale(true, now, now + STALE_SOURCE_MS - 1), false)
})

test('an online source past the window is stale: the signed link is gone', () => {
  assert.equal(sourceIsStale(true, now, now + STALE_SOURCE_MS), true)
})

test('nothing has expired before a url was ever loaded', () => {
  assert.equal(sourceIsStale(true, 0, now), false)
})

test('a short pause does not save a link that was already old', () => {
  // The window follows the link, not the pause. Pausing for a minute cannot make
  // an address that has been loaded for the whole window young again.
  const loadedAt = now - STALE_SOURCE_MS - 1
  assert.equal(sourceIsStale(true, loadedAt, now), true)
})

test('a link loaded before a long sleep still counts as expired', () => {
  // Date.now() moves across sleep; a wall-clock difference is the right input here.
  assert.equal(sourceIsStale(true, now, now + 26 * 3600 * 1000), true)
})
