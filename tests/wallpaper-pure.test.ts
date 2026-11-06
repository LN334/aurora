import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WallpaperEntry, WallpaperInfo } from '../src/env'
import {
  DEFAULT_STRENGTH,
  FOLLOW_SELECTION,
  chooseEntry,
  clampStrength,
  parseEnabled,
  parseStrength
} from '../src/features/wallpaper/pure.ts'

/**
 * Wallpaper Engine backdrop rules.
 *
 * These are the decisions that used to live inside a minified bundle, and each one
 * has a failure mode that is invisible until a real Wallpaper Engine install is in
 * front of it: a pinned project that vanished, a scene project with no .pkg, an
 * engine that is installed but has never selected a wallpaper. Pinning the rule here
 * means those states can be reasoned about without the engine present.
 */
function entry(id: string, over: Partial<WallpaperEntry> = {}): WallpaperEntry {
  return {
    id,
    title: id,
    kind: 'scene',
    previewUrl: `aurora-wallpaper://wp/${id}/preview.jpg`,
    sourceUrl: `aurora-wallpaper://wp/${id}/`,
    entryUrl: null,
    hasPackage: true,
    current: false,
    ...over
  }
}

const found: WallpaperInfo = {
  found: true,
  kind: 'scene',
  title: 'snow',
  src: 'D:\\Steam\\steamapps\\common\\wallpaper_engine',
  note: '',
  engineDir: 'D:\\Steam\\steamapps\\common\\wallpaper_engine'
}

const notFound: WallpaperInfo = {
  found: false,
  kind: 'none',
  title: '',
  src: null,
  note: '没有找到 Wallpaper Engine。',
  engineDir: null
}

test('the slider value is clamped so the veil never goes negative', () => {
  assert.equal(clampStrength(0), 0)
  assert.equal(clampStrength(0.42), 0.42)
  assert.equal(clampStrength(1), 1)
  assert.equal(clampStrength(2), 1)
  assert.equal(clampStrength(-0.1), 0)
  assert.equal(clampStrength(Number.NaN), DEFAULT_STRENGTH)
  assert.equal(clampStrength(Number.POSITIVE_INFINITY), DEFAULT_STRENGTH)
})

test('the feature defaults to on, and only "off" turns it off', () => {
  assert.equal(parseEnabled(null), true)
  assert.equal(parseEnabled('on'), true)
  assert.equal(parseEnabled('anything-else'), true)
  assert.equal(parseEnabled('off'), false)
})

test('a stored strength outside 0..1 falls back to the default', () => {
  assert.equal(parseStrength(null), DEFAULT_STRENGTH)
  assert.equal(parseStrength('0.8'), 0.8)
  assert.equal(parseStrength('0'), 0)
  assert.equal(parseStrength('1'), 1)
  assert.equal(parseStrength('1.4'), DEFAULT_STRENGTH)
  assert.equal(parseStrength('-1'), DEFAULT_STRENGTH)
  assert.equal(parseStrength('half'), DEFAULT_STRENGTH)
})

test('a disabled feature paints nothing, whatever is stored', () => {
  assert.equal(
    chooseEntry({ enabled: false, selection: 'a', info: found, list: [entry('a', { current: true })] }),
    null
  )
})

test('follow picks whatever Wallpaper Engine currently has selected', () => {
  const picked = chooseEntry({
    enabled: true,
    selection: FOLLOW_SELECTION,
    info: found,
    list: [entry('a'), entry('b', { current: true }), entry('c')]
  })
  assert.equal(picked?.id, 'b')
})

test('follow with nothing selected in Wallpaper Engine paints nothing', () => {
  assert.equal(
    chooseEntry({ enabled: true, selection: FOLLOW_SELECTION, info: found, list: [entry('a')] }),
    null
  )
})

test('a pinned wallpaper survives Wallpaper Engine switching its own choice', () => {
  const picked = chooseEntry({
    enabled: true,
    selection: 'a',
    info: found,
    list: [entry('a'), entry('b', { current: true })]
  })
  assert.equal(picked?.id, 'a')
})

test('a pinned wallpaper that left the library falls back to follow', () => {
  const picked = chooseEntry({
    enabled: true,
    selection: 'gone',
    info: found,
    list: [entry('b', { current: true })]
  })
  assert.equal(picked?.id, 'b')
})

test('no engine means no wallpaper even with a library on disk', () => {
  assert.equal(
    chooseEntry({ enabled: true, selection: FOLLOW_SELECTION, info: notFound, list: [entry('a', { current: true })] }),
    null
  )
})

test('a scene project without .pkg is still an entry - the renderer falls back to its preview', () => {
  const picked = chooseEntry({
    enabled: true,
    selection: 'a',
    info: found,
    list: [entry('a', { kind: 'scene', hasPackage: false })]
  })
  assert.equal(picked?.id, 'a')
  assert.equal(picked?.hasPackage, false)
})
