import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLyricBundle } from '../src/features/lyrics/align.ts'

/*
 * 译文与原文是两份独立的 LRC 文档，时间戳常常对不齐：网易云新歌的正文来自逐字
 * 歌词（行的起点是第一个字真正唱出的时刻），译文却是人手写的行级 LRC，同一句能
 * 差半秒。对不上就会各自成行——屏幕上原文下面多一行译文、播放时高亮在译文上，
 * 正是用户报的那两个症状。
 *
 * 这里钉住配对规则本身，以及「配不上宁可不要」的底线。
 */

const pairsOf = (bundle: Parameters<typeof parseLyricBundle>[0]) =>
  parseLyricBundle(bundle).lines.map((line) => [line.text, line.translation])

test('译文来自另一套时间网格时仍然贴在同一句下面', () => {
  const original = ['[00:17.040]I see myself', "[00:18.510]I'm all alone"].join('\n')
  const translation = ['[00:16.53]我看见自己', '[00:18.52]独自一人'].join('\n')
  assert.deepEqual(pairsOf({ lrc: original, translation }), [
    ['I see myself', '我看见自己'],
    ["I'm all alone", '独自一人']
  ])
})

test('行数不同时按整体偏移配对，而不是按精确时间戳', () => {
  const original = ['[00:01.00]a', '[00:02.00]b'].join('\n')
  // 译文整体晚 0.4 秒，并且多出一行给别的小节。
  const translation = ['[00:01.40]A', '[00:02.40]B', '[00:03.90]C'].join('\n')
  assert.deepEqual(pairsOf({ lrc: original, translation }), [
    ['a', 'A'],
    ['b', 'B']
  ])
})

test('没有原文的译文丢掉，不会在两句之间自己亮起来', () => {
  const result = pairsOf({ lrc: '[00:01.00]only', translation: '[00:01.00]only-tr\n[00:09.00]orphan' })
  assert.deepEqual(result, [['only', 'only-tr']])
})

test('两份歌词差得太远时宁可不配', () => {
  const original = ['[00:01.00]a', '[00:02.00]b'].join('\n')
  const translation = ['[00:30.00]A', '[00:31.00]B'].join('\n')
  assert.deepEqual(pairsOf({ lrc: original, translation }), [
    ['a', null],
    ['b', null]
  ])
})

test('乱序的原文按唱的顺序配对，不按文件里的顺序', () => {
  // 回归：按输入下标配对会把 a 配到 B、b 配到 A。
  assert.deepEqual(pairsOf({ lrc: '[00:02.00]b\n[00:01.00]a', translation: '[00:01.00]A\n[00:02.00]B' }), [
    ['a', 'A'],
    ['b', 'B']
  ])
})

test('副歌重复出现时共用第一次配到的译文', () => {
  assert.deepEqual(pairsOf({ lrc: '[00:01.00][00:05.00]chorus', translation: '[00:05.00]副歌' }), [
    ['chorus', '副歌'],
    ['chorus', '副歌']
  ])
})

test('译文与原文相同时不重复显示', () => {
  assert.deepEqual(pairsOf({ lrc: '[00:01.00]same', translation: '[00:01.00]same' }), [['same', null]])
})

test('没有译文时原文一行不少，也不多出字段', () => {
  assert.deepEqual(pairsOf({ lrc: '[00:01.00]hello\n[00:10.50]world' }), [
    ['hello', null],
    ['world', null]
  ])
})

test('只有译文时拿它当正文，而不是当译文叠在空行下面', () => {
  assert.deepEqual(pairsOf({ lrc: '', translation: '[00:01.00]你好' }), [['你好', null]])
})

test('两份都空才是真的没有歌词', () => {
  assert.equal(parseLyricBundle(null).empty, true)
  assert.equal(parseLyricBundle({ lrc: '', translation: '' }).empty, true)
  assert.equal(parseLyricBundle({ lrc: '   ' }).empty, true)
})

test('罗马音进自己的字段，不抢占译文的位置', () => {
  const lyrics = parseLyricBundle({
    lrc: '[00:01.00]ありがとう',
    translation: '[00:01.00]谢谢',
    roman: '[00:01.00]arigatou'
  })
  assert.equal(lyrics.lines[0].translation, '谢谢')
  assert.equal(lyrics.lines[0].roman, 'arigatou')
  assert.equal(lyrics.hasTranslation, true)
})

test('[mm:ss:xx] 与 [mm:ss.xx] 是同一时刻', () => {
  const lyrics = parseLyricBundle({ lrc: '[00:01:50]a', translation: '[00:01.50]A' })
  assert.equal(lyrics.lines[0].translation, 'A')
})

test('元数据标签不会变成歌词行', () => {
  const lyrics = parseLyricBundle({ lrc: '[ti:x]\n[offset:-500]\n[00:01.00]a', translation: '[00:01.00]A' })
  assert.deepEqual(lyrics.lines.map((line) => line.text), ['a'])
  assert.equal(lyrics.title, 'x')
})
