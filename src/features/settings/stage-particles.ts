import { useSyncExternalStore } from 'react'

/**
 * 舞台那一层光尘。
 *
 * 和首页分区开关同一套读写：localStorage + 外部快照，设置页与舞台共享一份。
 * 四个值都是「程度」而不是像素：舞台会在 940px 的窗口和 4K 全屏上跑，
 * 写死像素意味着其中一头一定不对。
 */
interface StageParticlePrefs {
  enabled: boolean
  /** 0..1 - 18 到 88 颗之间。 */
  density: number
  /** 0..1 - 上浮速度倍率。 */
  speed: number
  /** 0..1 - 半径倍率。 */
  size: number
}

const KEY = 'aurora.stage.particles'

const DEFAULTS: StageParticlePrefs = { enabled: true, density: 0.55, speed: 0.4, size: 0.5 }

let snapshot: StageParticlePrefs | null = null
/* 初值给 null 而不是空串：空串恰好等于「没存过」的 raw，那样默认配置就读不出快照。 */
let snapshotKey: string | null = null
const listeners = new Set<() => void>()

function rawValue(): string {
  try {
    return window.localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

function unit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

function parse(raw: string): StageParticlePrefs {
  const value: StageParticlePrefs = { ...DEFAULTS }
  if (!raw) return value
  try {
    const parsed = JSON.parse(raw) as Partial<StageParticlePrefs>
    if (typeof parsed.enabled === 'boolean') value.enabled = parsed.enabled
    value.density = unit(parsed.density, DEFAULTS.density)
    value.speed = unit(parsed.speed, DEFAULTS.speed)
    value.size = unit(parsed.size, DEFAULTS.size)
  } catch {
    // 坏值就当没设过：粒子是装饰，不该影响播放。
  }
  return value
}

function read(): StageParticlePrefs {
  const raw = rawValue()
  if (!snapshot || raw !== snapshotKey) {
    snapshot = parse(raw)
    snapshotKey = raw
  }
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useStageParticles(): StageParticlePrefs {
  return useSyncExternalStore(subscribe, read, read)
}

export function setStageParticles(patch: Partial<StageParticlePrefs>): void {
  const next: StageParticlePrefs = { ...read(), ...patch }
  next.density = unit(next.density, DEFAULTS.density)
  next.speed = unit(next.speed, DEFAULTS.speed)
  next.size = unit(next.size, DEFAULTS.size)
  let raw = ''
  try {
    raw = JSON.stringify(next)
    window.localStorage.setItem(KEY, raw)
  } catch {
    // 存不下也先把这一程的界面改了，别让滑块拖了没反应。
  }
  snapshot = next
  snapshotKey = raw
  for (const listener of listeners) listener()
}