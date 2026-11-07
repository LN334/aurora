import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseInitialSource } from '../src/app/search/initial-source.ts'

/**
 * Which catalogue a search starts on.
 *
 * The rule is small but it was silently wrong: the store asked the provider
 * registry while its own module was being evaluated, and the platforms register
 * themselves when their module runs - so whether a platform existed yet was decided
 * by import order, and a fresh install opened on the local catalogue while the code
 * claimed the first platform was the default. The rule now takes the tabs it is
 * given, so it can be pinned here.
 */
const local = { id: 'local', remote: false }
const netease = { id: 'netease', remote: true }
const qq = { id: 'qq', remote: true }
const all = { id: 'all', remote: true }

test('a build with no platform starts on the local catalogue', () => {
  assert.equal(chooseInitialSource([local], null), 'local')
  assert.equal(chooseInitialSource([], null), 'local')
})

test('two or more platforms start on combined search, not on one service', () => {
  assert.equal(chooseInitialSource([local, all, netease, qq], null), 'all')
  assert.equal(chooseInitialSource([local, all, qq, netease], null), 'all')
})

test('a single-platform build starts on that platform, in registry order', () => {
  assert.equal(chooseInitialSource([local, netease], null), 'netease')
  assert.equal(chooseInitialSource([local, qq, netease], null), 'qq')
})

test('a remembered source wins when this build still offers it', () => {
  assert.equal(chooseInitialSource([local, all, netease, qq], 'qq'), 'qq')
  assert.equal(chooseInitialSource([local, all, netease], 'local'), 'local')
})

test('a remembered source this build cannot serve falls back instead of sticking', () => {
  assert.equal(chooseInitialSource([local, all, netease], 'spotify'), 'all')
  assert.equal(chooseInitialSource([local, netease], 'spotify'), 'netease')
  assert.equal(chooseInitialSource([local], 'netease'), 'local')
})
