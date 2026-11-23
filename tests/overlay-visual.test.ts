import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitLyricSize, sungColor } from '../src/overlay/visual.ts'

/*
 * 桌面歌词的两个纯计算，钉在测试里：
 *  - 已唱颜色必须从封面取色提亮，不能照抄（照抄就是旧版那个「看起来像脏白」的原因）；
 *  - 长句只能缩字号，不能换行也不能硬切。
 */

const channels = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16)
]

const chroma = (hex: string): number => {
  const [r, g, b] = channels(hex)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

test('已唱颜色是合法十六进制', () => {
  assert.match(sungColor('#7d8899'), /^#[0-9a-f]{6}$/)
  assert.match(sungColor(''), /^#[0-9a-f]{6}$/)
  assert.match(sungColor('rgb(1,2,3)'), /^#[0-9a-f]{6}$/)
})

test('灰调的封面主色会被拉开饱和度，变成真正的彩色高亮', () => {
  const idle = '#7d8899'
  const sung = sungColor(idle)
  assert.notEqual(sung, idle)
  // 旧版直接拿 accent 上色：三个通道几乎贴着，进度看起来只是一块更脏的白。
  assert.ok(chroma(sung) >= 60, `${sung} 的通道差 ${chroma(sung)} 太小`)
})

test('很暗的封面主色被提到能看清的亮度', () => {
  const sung = channels(sungColor('#101820'))
  const brightest = Math.max(...sung)
  assert.ok(brightest >= 140, `最亮通道只有 ${brightest}`)
})

test('很亮的封面主色被压回区间，不会和白字糊在一起', () => {
  const sung = channels(sungColor('#fff6d8'))
  // 亮度被压到 0.8 以下，最暗通道就不会贴着 255——那样整行只是「更白的白」。
  assert.ok(Math.min(...sung) <= 200, `最暗通道 ${Math.min(...sung)} 太亮`)
})

test('短句不缩字号', () => {
  assert.equal(fitLyricSize(34, 600, 900), 34)
  assert.equal(fitLyricSize(34, 900, 900), 34)
})

test('长句按窗口宽度等比缩，且不小于 60%', () => {
  assert.equal(fitLyricSize(40, 1200, 900), 30)
  assert.equal(fitLyricSize(40, 3000, 900), 24)
})

test('量不到的尺寸原样返回，别把字号缩放成 0', () => {
  assert.equal(fitLyricSize(34, 0, 900), 34)
  assert.equal(fitLyricSize(34, 600, 0), 34)
  assert.equal(fitLyricSize(0, 600, 900), 0)
})
