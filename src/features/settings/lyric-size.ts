import { useSyncExternalStore } from 'react'

/*
 * 播放页歌词字号。
 *
 * 和「桌面歌词字号」是两件事：那个是独立小窗（主进程持有），这个是播放页里
 * 那一列歌词。它只在渲染层生效，存 localStorage 就够。
 *
 * 行高必须跟字号一起变：整列靠 translateY 精确居中，CSS 与 rAF 用的是同一个
 * 公式（lineHeightOf），改一处另处就错位。
 */

const KEY = 'aurora.lyrics.size'
export const LYRICS_MIN_SIZE = 15
export const LYRICS_MAX_SIZE = 24
const DEFAULT = 17

/** 17px 字号对应 44px 行高——这个系数是 CSS 里 .np__line 的原始比例。 */
const LINE_RATIO = 2.588

export function lineHeightOf(size: number): number {
  return Math.round(size * LINE_RATIO)
}

let snapshot: number | null = null
let snapshotKey: string | null = null
const listeners = new Set<() => void>()

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT
  return Math.max(LYRICS_MIN_SIZE, Math.min(LYRICS_MAX_SIZE, Math.round(value)))
}

export function readLyricSize(): number {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    raw = null
  }
  const key = raw ?? ''
  if (key !== snapshotKey || snapshot === null) {
    snapshotKey = key
    /* 空串不能直接 Number —— 会得 0，被 clamp 成最小值 15。 */
    snapshot = key === '' ? DEFAULT : clampSize(Number(key))
  }
  return snapshot
}

export function applyLyricSize(size: number): void {
  if (typeof document === 'undefined') return
  const value = clampSize(size)
  document.documentElement.style.setProperty('--np-line-size', value + 'px')
  document.documentElement.style.setProperty('--np-line-h', lineHeightOf(value) + 'px')
}

export function writeLyricSize(size: number): void {
  const value = clampSize(size)
  try {
    localStorage.setItem(KEY, String(value))
  } catch {
    // 存储被禁用时仍然让本次会话生效，只是记不住。
  }
  snapshotKey = String(value)
  snapshot = value
  applyLyricSize(value)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLyricSize(): number {
  return useSyncExternalStore(subscribe, readLyricSize, readLyricSize)
}

