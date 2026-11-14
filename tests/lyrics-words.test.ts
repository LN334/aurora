import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLrc, spokenWords } from '../src/features/lyrics/lrc.ts'

test('增强 LRC 的行内时间标签解析成词级时间', () => {
  const lyrics = parseLrc('[00:10.00]<00:10.00>第一段<00:11.50>第二段<00:13.00>第三段')
  assert.equal(lyrics.lines.length, 1)
  const line = lyrics.lines[0]
  assert.equal(line.text, '第一段第二段第三段')
  assert.deepEqual(line.words, [
    { time: 10, text: '第一段' },
    { time: 11.5, text: '第二段' },
    { time: 13, text: '第三段' }
  ])
})

test('第一个标签之前的文字算行首那一段', () => {
  const lyrics = parseLrc('[00:05.00]开头<00:06.00>后半<00:07.00>结尾')
  assert.deepEqual(lyrics.lines[0].words, [
    { time: 5, text: '开头' },
    { time: 6, text: '后半' },
    { time: 7, text: '结尾' }
  ])
})

test('只有一个行内标签时不当作逐字', () => {
  const lyrics = parseLrc('[00:05.00]<00:06.00>只有一段')
  assert.equal(lyrics.lines[0].words, undefined)
  assert.equal(lyrics.lines[0].text, '只有一段')
})

test('普通 LRC 没有词级数据', () => {
  const lyrics = parseLrc('[00:01.00]普通一行\n[00:02.00]另一行')
  assert.equal(lyrics.lines[0].words, undefined)
  assert.equal(lyrics.lines[0].text, '普通一行')
})

test('一行挂多个时间戳时，两行的词表互相独立', () => {
  const lyrics = parseLrc('[00:01.00][00:31.00]<00:01.00>一<00:02.00>二')
  assert.equal(lyrics.lines.length, 2)
  assert.deepEqual(lyrics.lines[0].words, [
    { time: 1, text: '一' },
    { time: 2, text: '二' }
  ])
  // 第二份是复制出来的：起点不同，词的时间是绝对时间，不该跟着变。
  assert.equal(lyrics.lines[1].time, 31)
  assert.deepEqual(lyrics.lines[1].words, [
    { time: 1, text: '一' },
    { time: 2, text: '二' }
  ])
})

test('offset 同时作用在行时间和词时间上', () => {
  const lyrics = parseLrc('[offset:1500]\n[00:10.00]<00:10.00>甲<00:11.00>乙')
  const line = lyrics.lines[0]
  assert.equal(line.time, 8.5)
  assert.deepEqual(line.words, [
    { time: 8.5, text: '甲' },
    { time: 9.5, text: '乙' }
  ])
})

test('spokenWords 按时间数到第几段', () => {
  const words = [
    { time: 10, text: 'a' },
    { time: 11, text: 'b' },
    { time: 12, text: 'c' }
  ]
  assert.equal(spokenWords(words, 9.9), 0)
  assert.equal(spokenWords(words, 10), 1)
  assert.equal(spokenWords(words, 10.5), 1)
  assert.equal(spokenWords(words, 11), 2)
  assert.equal(spokenWords(words, 99), 3)
  assert.equal(spokenWords([], 5), 0)
})
