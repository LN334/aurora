import assert from 'node:assert/strict'
import { test } from 'node:test'
import { yrcToEnhancedLrc } from '../electron/pure/yrc.ts'
import { parseLrc } from '../src/features/lyrics/lrc.ts'

/*
 * yrc → 增强 LRC。
 *
 * 逐字时间只在主进程这里转一次，渲染层当成普通的 `<mm:ss.xx>` 读。所以这个函数
 * 只要保证两件事：每行的时间对准它自己的唱点，拼回来的文本和唱的一致。
 */

test('一个字一个唱点时，行时间在前、其余用尖括号', () => {
  const lrc = yrcToEnhancedLrc('[0,2170](0,720,0)索(720,720,0)南(1440,730,0)：')
  assert.equal(lrc, '[00:00.000]索<00:00.720>南<00:01.440>：')
})

test('整行时间与第一个字不完全对齐时，仍归到行时间', () => {
  const lrc = yrcToEnhancedLrc('[2850,21120](2880,555,0)མ(3435,555,0)ེ')
  assert.equal(lrc, '[00:02.850]མ<00:03.435>ེ')
})

test('credits 的 JSON 行不是歌词，丢掉', () => {
  const raw = ['{"t":-1000,"c":[{"tx":"作词: "}]}', '[0,1000](0,500,0)哈(500,500,0)哈'].join('\n')
  assert.equal(yrcToEnhancedLrc(raw), '[00:00.000]哈<00:00.500>哈')
})

test('没有逐字片段的行降级成普通 LRC，不丢句', () => {
  const lrc = yrcToEnhancedLrc('[60000,4000]只有一行时间')
  assert.equal(lrc, '[01:00.000]只有一行时间')
})

test('空文本与空输入不产出行', () => {
  assert.equal(yrcToEnhancedLrc(''), '')
  assert.equal(yrcToEnhancedLrc('[0,1000](0,500,0)'), '')
  assert.equal(yrcToEnhancedLrc('\n\n'), '')
})

test('尖括号与方括号被中和，不会被当成时间标签', () => {
  const lrc = yrcToEnhancedLrc('[0,1000](0,500,0)<(500,500,0)>')
  assert.equal(lrc, '[00:00.000]＜<00:00.500>＞')
})

test(
  '转回增强 LRC 再解析，每行的词拼起来正好是整行文本',
  () => {
    // 桌面歌词按「第几个词的框」推进像素边界；词比行少一个字，边界就整体偏一格。
    const lrc = yrcToEnhancedLrc('[0,3000](0,600,0)索(600,600,0)南(1200,900,0)： (2100,900,0)风')
    const { lines } = parseLrc(lrc)
    for (const line of lines) {
      if (!line.words) continue
      assert.equal(line.words.map((word) => word.text).join(''), line.text)
    }
  }
)
