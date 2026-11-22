/**
 * 各进程的内存占用。
 *
 * 数据来自 `app.getAppMetrics()`——Electron 自己按 Chromium 进程类型报的，
 * 比从外面查任务管理器准（外面按 exe 名聚合，分不出渲染进程和工具进程）。
 *
 * 这里只做聚合与文案，取数留给主进程。
 */

interface MetricRow {
  /** Chromium 的进程类型，例如 Browser / Tab / GPU / Utility。 */
  type: string
  /** 工作集，KB。 */
  workingSetKb: number
  /** 进程 id，给「哪个渲染进程」这类追问用。 */
  pid: number
}

interface MemorySummary {
  /** 合计，MB（保留一位小数）。 */
  totalMb: number
  /** 按类型拆开，MB，按占用从大到小。 */
  byType: { type: string; mb: number; processes: number }[]
  /** 进程个数。 */
  processes: number
}

/** 界面上的中文名；未知类型原样显示。 */
const TYPE_NAMES: Record<string, string> = {
  Browser: '主进程',
  Tab: '渲染进程',
  GPU: '显卡进程',
  Utility: '工具进程',
  Zygote: 'Zygote',
  'Pepper Plugin': '插件进程',
  'Plugin': '插件进程'
}

export function typeName(type: string): string {
  return TYPE_NAMES[type] ?? type
}

/**
 * 聚合。
 *
 * 不按 pid 去重：同一类型可能有多个进程（多个窗口就是多个 Tab），求和才对。
 * 传进来的值可能是 Electron 报的 KB，也可能是 0——0 就跳过，别让一个空进程把
 * 平均拉低（这里本来也不算平均）。
 */
export function summarizeMemory(rows: MetricRow[]): MemorySummary {
  const byType = new Map<string, { kb: number; processes: number }>()
  let totalKb = 0
  let processes = 0
  for (const row of rows) {
    const kb = Number.isFinite(row.workingSetKb) && row.workingSetKb > 0 ? row.workingSetKb : 0
    if (kb === 0) continue
    const row2 = byType.get(row.type) ?? { kb: 0, processes: 0 }
    row2.kb += kb
    row2.processes += 1
    byType.set(row.type, row2)
    totalKb += kb
    processes += 1
  }
  const list = [...byType]
    .map(([type, item]) => ({ type, mb: round1(item.kb / 1024), processes: item.processes }))
    .sort((a, b) => b.mb - a.mb)
  return { totalMb: round1(totalKb / 1024), byType: list, processes }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 分项串，不带合计——合计由界面单独放在右侧，两处都写就成了重复。 */
export function memoryParts(summary: MemorySummary): string {
  if (summary.processes === 0) return ''
  return summary.byType.map((item) => typeName(item.type) + ' ' + item.mb + ' MB').join(' · ')
}

/** 一句话（含合计），给只会显示一行文字的地方用。没有数据时给空串。 */
export function memoryLine(summary: MemorySummary): string {
  if (summary.processes === 0) return ''
  return '合计 ' + summary.totalMb + ' MB（' + summary.processes + ' 个进程）· ' + memoryParts(summary)
}
