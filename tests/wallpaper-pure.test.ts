import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WallpaperEntry, WallpaperInfo } from '../src/env'
import {
  DEFAULT_QUALITY,
  DEFAULT_STRENGTH,
  FOLLOW_SELECTION,
  chooseEntry,
  clampStrength,
  parseEnabled,
  parseQuality,
  parseStrength,
  sceneRenderOptions
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

test('quality falls back to balanced for anything unreadable', () => {
  assert.equal(DEFAULT_QUALITY, 'balanced')
  assert.equal(parseQuality(null), 'balanced')
  assert.equal(parseQuality('HIGH'), 'balanced')
  assert.equal(parseQuality(''), 'balanced')
  assert.equal(parseQuality('saver'), 'saver')
  assert.equal(parseQuality('sharp'), 'sharp')
})

test('every quality climbs in frame rate', () => {
  // 1080p、dpr 1：分辨率上限不触发，只看帧率与分辨率档的先后。
  const saver = sceneRenderOptions('saver', 1, 1920 * 1080)
  const balanced = sceneRenderOptions('balanced', 1, 1920 * 1080)
  const sharp = sceneRenderOptions('sharp', 1, 1920 * 1080)
  assert.equal(saver.fps, 20)
  assert.equal(balanced.fps, 30)
  assert.equal(sharp.fps, 60)
  for (const option of [saver, balanced, sharp]) {
    assert.ok(option.renderDpr >= 0.75, 'never drop below 0.75 - the scene turns to mush')
  }
})

test('a huge high-DPI window is capped by total pixels, not by the quality label alone', () => {
  // 4K + dpr 2：即便清晰档也不能按物理像素铺满，2.6M 像素的上限要压住它。
  const sharp = sceneRenderOptions('sharp', 2, 3840 * 2160)
  assert.ok(sharp.renderDpr < 1, '4K 上的清晰档应当被像素上限压到 1 以下')
  assert.ok(sharp.renderDpr >= 0.75)
  // 均衡档还要额外压到 1.25 以内。
  const balanced = sceneRenderOptions('balanced', 2, 1280 * 720)
  assert.ok(balanced.renderDpr <= 1.25)
})

test('garbage dpr or pixel counts never produce NaN', () => {
  const options = sceneRenderOptions('balanced', Number.NaN, 0)
  assert.ok(Number.isFinite(options.renderDpr))
  assert.ok(options.renderDpr >= 0.75)
})
