/**
 * 把「原文」和「译文」两份时间轴对上。
 *
 * 译文几乎从来不是原文的逐字复制：网易云给新歌的是 yrc 逐字正文（每行从第一个
 * 字真正唱出的毫秒开始），译文却是一份人手写的行级 LRC；两家平台之间也常见整体
 * 差半秒到几秒的平移。把两份当成「同一时间戳就是同一行」会整首配不上，结果就是
 * 译文自己成行、播放时高亮在译文上。
 *
 * 这里的做法与常见播放器一致，按可靠程度排队：
 *
 * 1. 行数相同时按顺序配对——同一份歌词的两种语言版本，行数一致是强信号；
 *    先按时间排序，乱序的原文文件不会把译文配串。
 * 2. 否则用最近邻的中位数估计整体偏移，再在容差内做贪心最近配对。
 * 3. 配不上的行丢掉：一句孤儿译文会在两行原文之间自己亮起来。
 * 4. 同一句原文重复出现（副歌）时，共用第一次配到的译文。
 *
 * 结果写进 `LyricLine.translation`，渲染层不再需要拆字符串。
 */
import { emptyLyrics, parseLrc, type Lyrics } from './lrc.ts'

/** 两份歌词交回的原始形状：正文、译文、罗马音各一份 LRC。 */
export interface LyricBundle {
  lrc: string
  translation?: string | null
  roman?: string | null
}

/** 同一句原文与译文允许的最大时间差（秒）。 */
const PAIR_TOLERANCE = 1.5
/** 两份歌词同源时，整体时间偏移不会超过这个值（秒）。 */
const MAX_SHIFT = 5
/** 句数不同时，配对率低于这个比例就当作两份不同的歌词，宁可不合并。 */
const MIN_PAIRED = 0.3

interface TimedLine {
  time: number
  text: string
}

function timed(raw: string): TimedLine[] {
  return parseLrc(raw).lines
    .filter((line) => line.text !== '')
    .map((line) => ({ time: line.time, text: line.text }))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

/**
 * Pair translation lines with original lines, by their index in the two arrays.
 *
 * Both arrays are sorted by time when they get here, so the index is the
 * position in the sung order — not the position in the file.
 */
function pairLines(original: TimedLine[], translated: TimedLine[]): Map<number, string> {
  const pairs = new Map<number, string>()
  if (original.length === 0 || translated.length === 0) return pairs

  if (original.length === translated.length) {
    let aligned = 0
    for (let index = 0; index < original.length; index += 1) {
      if (Math.abs(original[index].time - translated[index].time) <= MAX_SHIFT) aligned += 1
    }
    if (aligned * 5 >= original.length * 3) {
      for (let index = 0; index < original.length; index += 1) {
        if (translated[index].text !== original[index].text) pairs.set(index, translated[index].text)
      }
      return pairs
    }
  }

  const deltas = original.map((line) => {
    let nearest = Infinity
    let delta = 0
    for (const other of translated) {
      const distance = Math.abs(other.time - line.time)
      if (distance < nearest) {
        nearest = distance
        delta = other.time - line.time
      }
    }
    return delta
  })
  const shift = median(deltas)
  if (Math.abs(shift) > MAX_SHIFT) return pairs

  const taken = new Set<number>()
  let paired = 0
  for (let index = 0; index < original.length; index += 1) {
    let best = -1
    let bestDistance = PAIR_TOLERANCE + 1
    for (let other = 0; other < translated.length; other += 1) {
      if (taken.has(other)) continue
      const distance = Math.abs(translated[other].time - shift - original[index].time)
      if (distance < bestDistance) {
        bestDistance = distance
        best = other
      }
    }
    if (best < 0) continue
    taken.add(best)
    paired += 1
    if (translated[best].text !== original[index].text) pairs.set(index, translated[best].text)
  }

  // 行数不同、却连三成都配不上：多半是不同版本，硬配只会把诗句配错。
  if (paired < original.length * MIN_PAIRED) return new Map()
  return pairs
}

/**
 * 给每一行贴上它那一种副行（译文或罗马音），原地改 `lines`。
 *
 * 空行（只有时间戳的间隔记号）不参与配对，但保留在结果里继续当时间线索。
 */
function withAttachment(base: Lyrics, raw: string | null | undefined, slot: 'translation' | 'roman'): Lyrics {
  const text = raw?.trim()
  if (!text || base.lines.length === 0) return base

  const target = timed(text)
  const source = base.lines
    .filter((line) => line.text !== '')
    .map((line) => ({ time: line.time, text: line.text }))
  const pairs = pairLines(source, target)
  if (pairs.size === 0) return base

  /*
   * 副歌这类同一句在歌里出现多次，译文常常只在其中一个时间点写了一次。
   * 文本完全相同的行共用那条译文，不然重复的那一遍会孤单地没有翻译。
   */
  const shared = new Map<string, string>()
  for (const [index, value] of pairs) shared.set(source[index].text, value)

  let cursor = 0
  for (const line of base.lines) {
    if (line.text === '') continue
    const value = pairs.get(cursor) ?? shared.get(line.text)
    cursor += 1
    if (value === undefined) continue
    line[slot] = value
  }

  return { ...base, hasTranslation: base.lines.some((line) => line.translation !== null) }
}

/**
 * 一份 bundle -> 可直接渲染的 `Lyrics`。
 *
 * 没有正文只有译文时拿译文当正文：显示一句外语总比空着强，用户至少看得出这歌
 * 有词。两者都没有才是真的没有。
 */
export function parseLyricBundle(bundle: LyricBundle | null | undefined): Lyrics {
  if (!bundle) return emptyLyrics()
  const original = bundle.lrc?.trim() ?? ''
  const translation = bundle.translation?.trim() ?? ''
  const roman = bundle.roman?.trim() ?? ''
  if (!original && !translation) return emptyLyrics()

  const parsed = parseLrc(original || translation)
  if (parsed.lines.length === 0) return parsed

  // 正文缺席时译文当了正文，就不该再被当成「原文下面的译文」重复显示。
  let lyrics: Lyrics = original ? parsed : { ...parsed, hasTranslation: false }
  if (original && translation) lyrics = withAttachment(lyrics, translation, 'translation')
  if (roman) lyrics = withAttachment(lyrics, roman, 'roman')
  return lyrics
}
