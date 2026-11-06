import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerProvider, sourceTagFor } from '../src/features/online/registry.ts'
import type { OnlineMusicProvider } from '../src/features/online/types.ts'
import { makeTrack } from './fixtures.ts'

/**
 * The row's origin label.
 *
 * The rule the tests pin is the one a mixed list depends on: a list that speaks
 * with one voice prints nothing, a list that mixes origins prints an answer on
 * every row (including the files), and a source the running build does not know
 * still shows the id it was saved with rather than being called a local file.
 */
function stub(id: string, shortName?: string): OnlineMusicProvider {
  return {
    id,
    displayName: id.toUpperCase(),
    shortName,
    summary: '',
    disclosure: '',
    anonymousNote: '',
    capabilities: {
      search: false,
      playback: false,
      lyrics: false,
      auth: false,
      playlists: false,
      albums: false,
      artists: false,
      recommendations: false,
      userCloud: false,
      likes: false
    },
    available: () => true
  }
}

registerProvider(stub('netease', '网易云'))
registerProvider(stub('zeta'))

test('a list of files prints no origin at all', () => {
  assert.equal(sourceTagFor(makeTrack('a', 'C:\\m\\a.flac'), false), null)
})

test("one platform's own list prints nothing either", () => {
  assert.equal(
    sourceTagFor(makeTrack('netease:1', 'netease:1', { source: 'netease' }), false),
    null
  )
})

test('a mixed list labels the files as 本机 and the platform by its short name', () => {
  const local = sourceTagFor(makeTrack('a', 'C:\\m\\a.flac'), true)
  assert.deepEqual(local, { label: '本机', kind: 'local' })

  const online = sourceTagFor(makeTrack('netease:1', 'netease:1', { source: 'netease' }), true)
  assert.deepEqual(online, { label: '网易云', kind: 'netease' })
})

test('a platform without a short name falls back to its display name', () => {
  assert.deepEqual(sourceTagFor(makeTrack('zeta:1', 'zeta:1', { source: 'zeta' }), true), {
    label: 'ZETA',
    kind: 'zeta'
  })
})

test('a source this build does not know still names itself instead of claiming to be local', () => {
  assert.deepEqual(sourceTagFor(makeTrack('ghost:1', 'ghost:1', { source: 'ghost' }), true), {
    label: 'ghost',
    kind: 'ghost'
  })
})

test('an explicit local source is a file, not a platform', () => {
  assert.equal(sourceTagFor(makeTrack('a', 'C:\\m\\a.flac', { source: 'local' }), false), null)
  assert.deepEqual(sourceTagFor(makeTrack('a', 'C:\\m\\a.flac', { source: 'local' }), true), {
    label: '本机',
    kind: 'local'
  })
})

test('no track, no label', () => {
  assert.equal(sourceTagFor(null, true), null)
})
