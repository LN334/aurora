import { useSyncExternalStore } from 'react'

/**
 * 舞台歌词的「演出模板」。
 *
 * 舞台只有一种排版（九个固定槽位、中间那格永远是当前行），变化的是这一行
 * 怎么被演出来：整句发光、从左往右填色、一个字一个字浮现、或者压成左对齐
 * 的诗行。四套都只用 CSS 表达，数据层不变，所以切换不掉帧、不需要重新解析。
 *
 * 存在 localStorage 而不是主进程设置里：这是外观偏好，浏览器预览模式也该
 * 生效，而且舞台可能在设置页之外被单独打开。
 */
export const STAGE_STYLES = [
  {
    id: 'classic',
    name: '经典',
    note: '居中大字，当前行用封面颜色发光'
  },
  {
    id: 'karaoke',
    name: '卡拉 OK',
    note: '当前行按演唱进度从左填到右'
  },
  {
    id: 'typewriter',
    name: '逐字',
    note: '当前行一个字一个字浮出来'
  },
  {
    id: 'verse',
    name: '诗行',
    note: '左对齐，当前行压一条底色和竖线'
  }
] as const

export type StageStyleId = (typeof STAGE_STYLES)[number]['id']

const KEY = 'aurora.stage.style'
const IDS = STAGE_STYLES.map((item) => item.id) as readonly string[]

function read(): StageStyleId {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && IDS.includes(saved)) return saved as StageStyleId
  } catch {
    /* 隐私模式下 localStorage 会抛，退回默认 */
  }
  return 'classic'
}

const listeners = new Set<() => void>()

export function stageStyle(): StageStyleId {
  return read()
}

export function setStageStyle(next: StageStyleId): void {
  if (!IDS.includes(next)) return
  try {
    localStorage.setItem(KEY, next)
  } catch {
    return
  }
  for (const listener of listeners) listener()
}

export function useStageStyle(): StageStyleId {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    () => 'classic' as StageStyleId
  )
}
