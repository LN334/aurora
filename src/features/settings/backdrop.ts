import { useSyncExternalStore } from 'react'

/**
 * 背景处理：壁纸透出来多少，糊到什么程度。
 *
 * 两档是两条不同的路，不是强弱之分：
 * - frosted（磨砂）：壁纸先被 blur 糊成一片颜色，四块区盖一层薄底，字靠深色与
 *   模糊站稳。这是默认，也是壁纸很花时唯一还能读字的档。
 * - clear（透出）：不铺底、不模糊，壁纸原样铺满，字直接压在图上。适合本身安静
 *   的壁纸，或者就是想看清图的时候。
 *
 * 磨砂程度是 frosted 的细调：0 表示「只铺一层淡底、不糊」，往上是糊到看不见细节。
 * 两条都落在 CSS 变量上（--ui-blur / --ui-veil），改完当场生效，不用重载。
 */

type BackdropMode = 'frosted' | 'clear'

interface BackdropPref {
  mode: BackdropMode
  blur: number
}

const KEY = 'aurora.backdrop'

export const BLUR_MIN = 0
export const BLUR_MAX = 40
const BLUR_DEFAULT = 14

const DEFAULT_PREF: BackdropPref = { mode: 'frosted', blur: BLUR_DEFAULT }

const listeners = new Set<() => void>()
let snapshot: BackdropPref | null = null
let snapshotKey: string | null = null

function clampBlur(value: number): number {
  if (!Number.isFinite(value)) return BLUR_DEFAULT
  return Math.min(BLUR_MAX, Math.max(BLUR_MIN, Math.round(value)))
}

export function applyBackdrop(pref: BackdropPref): void {
  const root = document.documentElement
  const blur = pref.mode === 'frosted' ? clampBlur(pref.blur) : 0
  root.style.setProperty('--ui-blur', blur + 'px')
  /*
   * 透出不是「一点底都不要」：试过 0，浅色壁纸一亮，正文直接糊在图上读不了。
   * 0.7 是「图看得清」和「字还站得住」之间那一档：底只剩三成多，但正文不飘。
   */
  root.style.setProperty('--ui-veil', pref.mode === 'frosted' ? '1' : '0.7')
  root.dataset.backdrop = pref.mode
}

function parse(raw: string): BackdropPref | null {
  try {
    const value = JSON.parse(raw) as Partial<BackdropPref> | null
    if (!value || (value.mode !== 'frosted' && value.mode !== 'clear')) return null
    return { mode: value.mode, blur: clampBlur(Number(value.blur ?? BLUR_DEFAULT)) }
  } catch {
    return null
  }
}

export function readBackdrop(): BackdropPref {
  const raw = localStorage.getItem(KEY) ?? ''
  if (snapshot !== null && raw === snapshotKey) return snapshot
  snapshot = parse(raw) ?? DEFAULT_PREF
  snapshotKey = raw
  return snapshot
}

export function writeBackdrop(pref: BackdropPref): void {
  const next: BackdropPref = { mode: pref.mode, blur: clampBlur(pref.blur) }
  const raw = JSON.stringify(next)
  localStorage.setItem(KEY, raw)
  snapshot = next
  snapshotKey = raw
  applyBackdrop(next)
  for (const listener of listeners) listener()
}

export function useBackdrop(): BackdropPref {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    readBackdrop,
    readBackdrop,
  )
}
