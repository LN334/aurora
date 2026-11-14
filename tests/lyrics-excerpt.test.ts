import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickLyricExcerpt } from '../src/features/lyrics/excerpt.ts'

/**
 * 喜欢页那张卡直接拿这些行当背景词，所以过滤错了会很难看：
 * 制作名单、空行、占位符号都不该出现在卡片上。
 */

const LRC = [
  '[ti:测试]',
  '[ar:某歌手]',
  '[00:00.00]作词：甲',
  '[00:01.00]作曲：乙',
  '[00:02.00]编曲：丙',
  '[00:03.00]',
  '[00:04.00]第一句',
  '[00:08.00]第二句',
  '[00:12.00]第三句',
  '[00:16.00]第四句'
].join('\n')

test('skips credits and blank lines', () => {
  const lines = pickLyricExcerpt(LRC, 3, () => 0)
  assert.deepEqual(lines, ['第一句', '第二句', '第三句'])
})

test('starts somewhere inside the song', () => {
  // 0.99 lands on the last window: three lines ending at the last one.
  assert.deepEqual(pickLyricExcerpt(LRC, 3, () => 0.99), ['第二句', '第三句', '第四句'])
})

test('returns everything when the song is shorter than asked for', () => {
  const raw = '[00:01.00]只有一句'
  assert.deepEqual(pickLyricExcerpt(raw, 3, () => 0), ['只有一句'])
})

test('filters 「纯音乐，请欣赏」 and symbol-only lines', () => {
  const raw = [
    '[00:01.00]纯音乐，请欣赏',
    '[00:02.00]♪',
    '[00:03.00]——',
    '[00:04.00]真正的词'
  ].join('\n')
  assert.deepEqual(pickLyricExcerpt(raw, 3, () => 0), ['真正的词'])
})

test('works on plain text without timestamps', () => {
  const raw = ['Lyrics by: someone', 'Composed by: someone', '第一句', '第二句'].join('\n')
  assert.deepEqual(pickLyricExcerpt(raw, 2, () => 0), ['第一句', '第二句'])
})

test('drops colon credits written with full-width punctuation', () => {
  const raw = ['[00:01.00]词：某人', '[00:02.00]曲：某人', '[00:03.00]留下来'].join('\n')
  assert.deepEqual(pickLyricExcerpt(raw, 3, () => 0), ['留下来'])
})

test('returns nothing when there is nothing usable', () => {
  assert.deepEqual(pickLyricExcerpt('', 3), [])
  assert.deepEqual(pickLyricExcerpt('[00:01.00]作词：甲', 3, () => 0), [])
  assert.deepEqual(pickLyricExcerpt(LRC, 0, () => 0), [])
})

test('a bad random draw falls back to the start', () => {
  assert.deepEqual(pickLyricExcerpt(LRC, 3, () => Number.NaN), ['第一句', '第二句', '第三句'])
})
