/**
 * 网易云的逐字歌词（yrc）→ 增强 LRC。
 *
 * yrc 的一行是这样一串：
 *   [2850,21120](2850,555,0)མ(3405,555,0)ེ…
 * 第一个方括号是整行的开始与时长（毫秒），后面每个圆括号是**一个字**的绝对
 * 开始、时长和保留位。开头的 `{"t":-1000,"c":[…]}` 是 credits，不是歌词。
 *
 * 我们把它写成增强 LRC 的尖括号形式（`[00:02.850]索<00:03.570>南`），因为渲染层
 * 的解析器已经会读 `<mm:ss.xx>`（见 `src/features/lyrics/lrc.ts` 的 `wordTimings`），
 * 逐字数据到这一层就够：中间那几层不用各加一个字段，也不会出现两份歌词文本。
 *
 * 第一个字不写标签——它的时间就是行时间，写了只是让解析器多做一次比对。
 */

/** 一行 yrc：`[行开始,行时长]片段…`。 */
const LINE = /^\[(\d+),(\d+)\](.*)$/
/** 一个片段的头：`(字开始,字时长,保留位)`；它后面的文本一直取到下一个左括号。 */
const WORD = /\((\d+),(\d+),-?\d+\)([^(]*)/g

/** 毫秒 → `mm:ss.SSS`。超过一小时的歌不常见，分钟位按需增长。 */
function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const fraction = total % 1000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`
}

/**
 * 尖括号与方括号是解析器的语法，字面上出现会把它读成时间标签。
 * 歌词里真出现 `<` 的只有颜文字，换成等宽的全角字符，读起来一样。
 */
const neutralize = (text: string): string =>
  text.replace(/[<>\[\]]/g, (char) => (char === '<' ? '＜' : char === '>' ? '＞' : char === '[' ? '［' : '］'))

/**
 * 把整份 yrc 转成增强 LRC。
 *
 * 认不出片段的行（只有行时间、没有逐字）原样降级成普通 LRC 行：逐字是加分项，
 * 缺了也不该让这一句从屏幕上消失。空文本与 credits 行直接丢掉。
 */
export function yrcToEnhancedLrc(yrc: string): string {
  if (!yrc) return ''
  const out: string[] = []
  for (const raw of yrc.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('{')) continue
    const head = LINE.exec(line)
    if (!head) continue
    const start = Number(head[1])
    const body = head[3] ?? ''

    const words: Array<{ time: number; text: string }> = []
    /* 括号之前若还有字（正常数据里没有），它属于这一句的第一笔，不能丢。 */
    let lead = ''
    let scanned = false
    WORD.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = WORD.exec(body)) !== null) {
      if (!scanned) {
        scanned = true
        lead = neutralize(body.slice(0, match.index))
      }
      const text = neutralize(match[3] ?? '')
      if (!text) continue
      words.push({ time: Number(match[1]), text })
    }
    if (lead && words.length > 0) words[0].text = lead + words[0].text

    const plain = neutralize(body.replace(WORD, '')).trim()
    if (words.length === 0) {
      if (plain) out.push(`[${stamp(start)}]${plain}`)
      continue
    }

    /* 第一个字回到行时间：片段偶尔比行晚几毫秒（上游按字对齐抖动），不该另起一行。 */
    const first = words[0]
    first.time = Math.min(first.time, start)
    const rendered = words
      .map((word, index) => (index === 0 ? word.text : `<${stamp(word.time)}>${word.text}`))
      .join('')
    out.push(`[${stamp(start)}]${rendered}`)
  }
  return out.join('\n')
}
