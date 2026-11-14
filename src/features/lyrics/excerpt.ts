import { parseLrc } from './lrc.ts'

/**
 * 从一份歌词里挑连续几行，当喜欢页那张卡的背景词。
 *
 * 挑的是「正在唱的三行」，所以要有三件事：
 *   1. 不挑制作名单。LRC 里混着「作词：」「作曲：」，本地文件的纯文本歌词更是
 *      整段 credits 都在；挑到它们就等于把卡片变成了片尾字幕。
 *   2. 不挑空行与纯符号行（有些文件用「♪」占位）。
 *   3. 起点随机。每次进喜欢页都是同一句词会很僵。
 *
 * 不做「按热度挑金句」那套：没有数据支撑，随机起点反而诚实——它展示的就是
 * 这首歌里真实存在的某三行。
 */

/** 中文制作名单的常见开头。单个「词」「曲」太容易是歌词本身，只在带冒号时才算。 */
const CREDIT_PREFIXES = [
  '作词',
  '作曲',
  '编曲',
  '填词',
  '制作',
  '监制',
  '出品',
  '发行',
  '录音',
  '混音',
  '母带',
  '吉他',
  '贝斯',
  '合声',
  '和声',
  '统筹',
  '企划',
  '鸣谢',
  '纯音乐',
  '请欣赏',
  '词作者',
  '曲作者',
  '翻译',
  '校对'
]

const COLON_CREDIT = /^[词曲][：:]/
const ENGLISH_CREDIT =
  /^(lyrics|composed|produced|written|arranged|mixed|mastered|music|words|vocals?)\s*(by|:)/i
/** 只有标点或符号的行：装饰、分隔、「♪」。 */
const ONLY_MARKS = /^[\p{P}\p{S}\s]+$/u

function isCreditLine(text: string): boolean {
  if (COLON_CREDIT.test(text)) return true
  const head = text.toLowerCase()
  return (
    CREDIT_PREFIXES.some((prefix) => head.startsWith(prefix)) || ENGLISH_CREDIT.test(head)
  )
}

/**
 * 能当作歌词的行。
 *
 * 先按 LRC 解析；一个时间戳都没有时（本地 .txt 歌词、平台返回的纯文本），
 * 退回按行切分——否则这种歌在喜欢页上永远空白。
 */
function usableLines(raw: string): string[] {
  const parsed = parseLrc(raw)
  const texts = parsed.lines.length
    ? parsed.lines.map((line) => line.text)
    : raw.split(/\r?\n/)

  return texts
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && !isCreditLine(text) && !ONLY_MARKS.test(text))
}

/**
 * 取 `count` 行连续歌词。`random` 可注入，测试里就不用跟随机数赌。
 * 歌词不足时返回全部可用的行；一行都没有时返回空数组，由调用方决定怎么收场。
 */
export function pickLyricExcerpt(
  raw: string,
  count = 3,
  random: () => number = Math.random
): string[] {
  const lines = usableLines(raw)
  const size = Math.min(count, lines.length)
  if (size <= 0) return []

  const span = lines.length - size + 1
  const draw = random()
  const safe = Number.isFinite(draw) ? draw : 0
  const start = Math.min(span - 1, Math.max(0, Math.floor(safe * span)))
  return lines.slice(start, start + size)
}
