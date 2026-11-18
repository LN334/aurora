import assert from 'node:assert/strict'
import { test } from 'node:test'
import { qishuiLrc, qishuiLyricsFromInfo } from '../electron/qishui/lyrics.ts'

/**
 * 样本按 2026-11 实测的酷狗… 不，汽水返回抄的：正文是「[起始,时长] + 逐字标记」，
 * 译文是标准 LRC。测试不联网，只钉住两边换算与挑语言轨的规则。
 */

const BODY = [
  '[1540,2380]<0,810,0>沈<810,450,0>む<1260,460,0>よ<1720,350,0>う<2070,310,0>に',
  '[3920,3840]<0,350,0>溶<350,360,0>け<710,300,0>て<1010,350,0>ゆ<1360,200,0>く<1560,410,0>よ<1970,500,0>う<2470,1370,0>に'
].join('\n')

const TRANSLATION = ['[00:01.54]仿佛沉溺其中', '[00:03.92]又好似逐渐消融'].join('\n')

function info(body: string, translations?: Record<string, { content: string }>): unknown {
  return {
    lyric_entity: { content: body },
    ...(translations ? { lang_translations: translations } : {})
  }
}

test('turns the karaoke body into standard LRC', () => {
  const lrc = qishuiLrc(BODY)
  assert.equal(lrc, '[00:01.54]沈むように\n[00:03.92]溶けてゆくように')
})

test('keeps standard LRC lines and drops metadata', () => {
  const lrc = qishuiLrc('[ti:夜に駆ける]\n[00:01.54]沈むように')
  assert.equal(lrc, '[00:01.54]沈むように')
})

test('reads the body and the Simplified Chinese track', () => {
  const lyrics = qishuiLyricsFromInfo(info(BODY, { 'ZH-HANS-CN': { content: TRANSLATION } }))
  assert.ok(lyrics)
  assert.equal(lyrics.lrc, '[00:01.54]沈むように\n[00:03.92]溶けてゆくように')
  assert.equal(lyrics.translation, TRANSLATION)
})

test('prefers Simplified Chinese over another CJK track', () => {
  const lyrics = qishuiLyricsFromInfo(
    info(BODY, {
      'ZH-HANT-TW': { content: '[00:01.54]彷彿沉溺其中' },
      'ZH-HANS-CN': { content: TRANSLATION }
    })
  )
  assert.equal(lyrics?.translation, TRANSLATION)
})

test('leaves translation empty for a Chinese song with no language track', () => {
  const lyrics = qishuiLyricsFromInfo(info('[25770,2610]<0,370,0>这<600,310,0>一<910,300,0>路'))
  assert.ok(lyrics)
  assert.equal(lyrics.translation, '')
  assert.equal(lyrics.lrc, '[00:25.77]这一路')
})

test('skips a language track that repeats the body', () => {
  const body = '[1000,500]<0,500,0>第一行'
  const lyrics = qishuiLyricsFromInfo(info(body, { 'ZH-HANS-CN': { content: qishuiLrc(body) } }))
  assert.equal(lyrics?.translation, '')
})

test('returns null when the payload carries no lyric body', () => {
  assert.equal(qishuiLyricsFromInfo(null), null)
  assert.equal(qishuiLyricsFromInfo({}), null)
  assert.equal(qishuiLyricsFromInfo({ lyric_entity: { content: '' } }), null)
})
