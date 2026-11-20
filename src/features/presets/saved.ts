/**
 * 「我的预设」的纯逻辑：起名、上限、认不认得出当前这条曲线。
 *
 * 与分享码分开：码是发给别人的一条曲线，这个列表是留在这台机器上的一排常用
 * 方案。两者都只是「一组增益 + 开关」，所以判断「当前是不是已经等于某一条」
 * 用的是同一套比较，不必各写一份。
 */

export interface SavedPreset {
  id: string
  name: string
  /** 存的时候均衡是开着的吗；应用时一起带过去，否则存了也听不出差别。 */
  eqEnabled: boolean
  /** 十个增益，顺序同 EQ_BANDS。 */
  gains: number[]
  /** Unix 毫秒：存下来的时刻，超上限时按它丢最老的。 */
  at: number
}

/**
 * 最多留这么多条。
 *
 * 再多，面板顶部那排芯片就成了一堵墙，找一条预设比重新拖一遍还慢。
 */
export const MAX_SAVED = 20

/** 下一个自动编号：从「我的预设 1」开始，找第一个没被占用的号。 */
export function nextName(list: SavedPreset[]): string {
  const used = new Set(list.map((item) => item.name))
  for (let n = 1; n <= MAX_SAVED + 1; n += 1) {
    const name = '我的预设 ' + n
    if (!used.has(name)) return name
  }
  return '我的预设'
}

/** 存一条；超出上限时丢最早的那条，新存的一定留下。 */
export function withPreset(list: SavedPreset[], preset: SavedPreset): SavedPreset[] {
  const next = [...list, preset]
  if (next.length <= MAX_SAVED) return next
  const oldest = [...next].sort((a, b) => a.at - b.at).slice(0, next.length - MAX_SAVED)
  const dropped = new Set(oldest.map((item) => item.id))
  return next.filter((item) => !dropped.has(item.id))
}

export function withoutPreset(list: SavedPreset[], id: string): SavedPreset[] {
  return list.filter((item) => item.id !== id)
}

/** 当前这条曲线是不是就是某条预设：增益逐条相等，开关也一样。 */
export function isSameCurve(preset: SavedPreset, gains: number[], enabled: boolean): boolean {
  if (preset.eqEnabled !== enabled) return false
  if (preset.gains.length !== gains.length) return false
  return preset.gains.every((gain, index) => gain === (gains[index] ?? 0))
}
