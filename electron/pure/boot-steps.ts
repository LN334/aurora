/**
 * 启动步骤记录。
 *
 * 借鉴 Folia 的 `createStartupRecorder`：把「启动」拆成有名字的步骤，记下每一步
 * 的绝对时刻和它与上一步的间隔。出问题时一眼能看出卡在哪一段——现在的
 * `startup.log` 只有一堆平铺的行，想知道「打开用了 3 秒是慢在协议注册还是慢在
 * 读窗口尺寸」得靠时间戳自己减。
 *
 * 这里刻意比它轻：我们的启动几乎全是同步步骤，只有一个 ready-to-show 是异步的，
 * 不需要它那套 begin/step/finish 的三层状态机。保留 `mark` 与 `fail` 两个动作
 * 就够了。
 */

interface BootStep {
  /** 步骤名，写进日志时保持短、无空格。 */
  id: string
  /** 距启动的毫秒数。 */
  at: number
  /** 与上一步的间隔；第一步为 null。 */
  sinceLast: number | null
  /** 失败时是错误文字；成功为 null。 */
  error: string | null
}

export interface BootRecorder {
  mark(id: string): void
  fail(id: string, error: unknown): void
  snapshot(): BootStep[]
}

const MAX_STEPS = 80

function describe(error: unknown): string {
  if (typeof error === 'string') return error.trim() || 'unknown'
  if (error instanceof Error) {
    const coded = error as unknown as { code?: unknown }
    const code = typeof coded.code === 'string' ? coded.code : ''
    const message = error.message || error.name || 'unknown'
    return code && !message.includes(code) ? code + ': ' + message : message
  }
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return 'unknown'
}

/**
 * 造一个记录器。`log` 收一行人话，主进程传 `write` 进 startup.log；不传就只留内存。
 *
 * 记满 MAX_STEPS 之后丢弃后续：启动步骤本来就不该有上百个，真到了那个数量说明
 * 有人把循环里的东西也 mark 进来了。
 */
export function createBootRecorder(opts: {
  now?: () => number
  log?: (line: string) => void
  startedAt?: number
} = {}): BootRecorder {
  const now = opts.now ?? Date.now
  const startedAt = opts.startedAt ?? now()
  const steps: BootStep[] = []

  const push = (id: string, error: string | null): void => {
    if (steps.length >= MAX_STEPS) return
    const at = now() - startedAt
    const previous = steps.length > 0 ? steps[steps.length - 1].at : null
    const step: BootStep = { id, at, sinceLast: previous === null ? null : at - previous, error }
    steps.push(step)
    const gap = step.sinceLast === null ? '' : ' (+' + step.sinceLast + 'ms)'
    const tail = error ? ' FAILED ' + error : ''
    opts.log?.('boot: ' + id + ' +' + at + 'ms' + gap + tail)
  }

  return {
    mark: (id) => push(id, null),
    fail: (id, error) => push(id, describe(error)),
    snapshot: () => steps.slice()
  }
}

/** 给导出文件用的一段文字；没有步骤就给空串，别在报告里留个空标题。 */
export function formatBootSteps(steps: BootStep[]): string {
  if (steps.length === 0) return ''
  return steps
    .map((step) => {
      const gap = step.sinceLast === null ? '' : ' (+' + step.sinceLast + 'ms)'
      const tail = step.error ? '  FAILED ' + step.error : ''
      return '- ' + step.id + '：+' + step.at + 'ms' + gap + tail
    })
    .join('\n')
}

/**
 * 进程内唯一的一份记录器。
 *
 * 主进程启动时把它设进来，导出诊断时从这里取——两边不必互相 import，也不必将
 * 记录器在调用链里一路往下传。
 */
let active: BootRecorder | null = null

export function setActiveBootRecorder(recorder: BootRecorder | null): void {
  active = recorder
}

export function activeBootSteps(): BootStep[] {
  return active ? active.snapshot() : []
}
