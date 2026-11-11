/**
 * 播放模式：播放条上那一颗键的四个状态。
 *
 * 内核仍是 shuffle 布尔 + repeat 三态两个字段——漫游换队列、持久化、队列步进
 * 都靠它们；这里只是把两颗键并成一颗，用一层模式名把六个组合收成四个。
 * 四个状态足以表达用户能感知的差别：顺序一趟、列表转圈、单曲磨、随机打乱。
 */
import type { RepeatMode } from '../../types'

export type PlayMode = 'order' | 'loop' | 'one' | 'shuffle'

/** 点一次走到下一个。随机排最后，因为它是最「跳出」的一档。 */
const CYCLE: PlayMode[] = ['order', 'loop', 'one', 'shuffle']

interface ModeText {
  /** 读屏与 aria-label：说清现在是哪种。 */
  label: string
  /** 悬浮气泡里的短词。 */
  tip: string
  /** 原生 title：多一句怎么播，省得要靠试。 */
  hint: string
}

export const MODE_TEXT: Record<PlayMode, ModeText> = {
  order: { label: '顺序播放', tip: '顺序播放', hint: '顺序播放 · 播到队尾就停' },
  loop: { label: '列表循环', tip: '列表循环', hint: '列表循环 · 播完回到第一首' },
  one: { label: '单曲循环', tip: '单曲循环', hint: '单曲循环 · 一直重放这一首' },
  shuffle: { label: '随机播放', tip: '随机播放', hint: '随机播放 · 打乱整条队列' }
}

/** 内核状态反推模式。随机优先于单曲：shuffle 开着时那才是真的在发生的事。 */
export function modeOf(shuffle: boolean, repeat: RepeatMode): PlayMode {
  if (shuffle) return 'shuffle'
  if (repeat === 'one') return 'one'
  return repeat === 'all' ? 'loop' : 'order'
}

export function nextMode(current: PlayMode): PlayMode {
  const at = CYCLE.indexOf(current)
  return CYCLE[(at + 1) % CYCLE.length]
}

/**
 * 模式落到内核的两个字段。
 *
 * 随机配 repeat='all'：随机播完一轮接着下一轮，而不是停在最后一首——
 * 用户点「随机」多半是想一直有歌听。
 */
export function applyMode(mode: PlayMode): { shuffle: boolean; repeat: RepeatMode } {
  switch (mode) {
    case 'loop':
      return { shuffle: false, repeat: 'all' }
    case 'one':
      return { shuffle: false, repeat: 'one' }
    case 'shuffle':
      return { shuffle: true, repeat: 'all' }
    default:
      return { shuffle: false, repeat: 'off' }
  }
}
