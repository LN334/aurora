/**
 * 时间查询：当前唱到第几行、第几个字。
 *
 * 这些函数每帧都会被调用几次，所以逐个二分，不建索引也不缓存。它们只读
 * `Lyrics`，不碰 DOM，也不认识播放器。
 */
import type { LyricLine, LyricWord } from './lrc.ts'

/**
 * How many word segments have started at `position`.
 *
 * Same shape as `activeLineAt` and for the same reason: this is asked every
 * animation frame while a word-timed line is on screen.
 */
export function spokenWords(words: readonly LyricWord[], position: number): number {
  let low = 0
  let high = words.length - 1
  let found = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if (words[mid].time <= position) {
      found = mid + 1
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/**
 * 正在唱的那个词，以及它唱到几成。
 *
 * `spokenWords` 只回答「已经起了几个词」，点亮还是整词一格一格跳。上游能给到
 * 的最细时间是词：一个英文单词里的字母没有各自的时间戳。于是当前词内部就按
 * 它到下一个词的间隔做线性插值，把「跳」摊成「扫」——这是逐字歌词在没有字级
 * 时间时的唯一做法。
 *
 * - `index === -1`：这一行还没开口。
 * - `index === words.length - 1 && ratio === 1`：整行唱完了。
 */
export function sweepingWord(
  words: readonly LyricWord[],
  position: number
): { index: number; ratio: number } {
  if (words.length === 0) return { index: -1, ratio: 0 }
  if (position < words[0].time) return { index: -1, ratio: 0 }
  const index = spokenWords(words, position) - 1
  if (index >= words.length - 1) return { index: words.length - 1, ratio: 1 }
  const start = words[index].time
  const end = words[index + 1].time
  if (end <= start) return { index, ratio: 1 }
  const ratio = Math.min(1, Math.max(0, (position - start) / (end - start)))
  return { index, ratio }
}

/**
 * Index of the line that should be highlighted at `position`, or -1 before the
 * first line begins. Binary search: lyric lookups run on every animation frame.
 */
export function activeLineAt(lines: readonly LyricLine[], position: number): number {
  if (lines.length === 0) return -1
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= position) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}
