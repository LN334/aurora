/**
 * 显卡加速是否真的在工作。
 *
 * 这是 Folia 的 issue #1300 那类问题：某次更新之后 GPU 管线掉了，界面只是
 * 「莫名其妙变慢」，壁纸不重绘、模糊发糊，但没有任何一处告诉用户「现在在
 * 用 CPU 软渲染」。Electron 自己知道这件事——`app.getGPUFeatureStatus()`
 * 会把每条管线的状态报出来——只是我们一直没读。
 *
 * 这里只做判定，读值留给主进程。
 */

/**
 * `app.getGPUFeatureStatus()` 的返回形状（功能名 → 状态串）。
 *
 * 判定函数的入参刻意写成 `unknown`：这是运行时数据，Electron 那边的类型还带
 * 具名成员、没有索引签名，硬套一个类型只会逼着调用处做 cast。函数内部自己窄化。
 */

interface GpuProblem {
  /** 功能名，例如 `gpu_compositing`。 */
  feature: string
  /** Electron 报的状态串，例如 `disabled_software`。 */
  state: string
  /** 这句话是给人看的。 */
  message: string
}

/** 这几条是「界面会不会卡」的真正判据；其余是可选加速。 */
const CRITICAL: { feature: string; message: string }[] = [
  { feature: 'gpu_compositing', message: '窗口合成走的是 CPU' },
  { feature: 'webgl', message: 'WebGL 不可用（壁纸与特效会失效）' },
  { feature: 'webgl2', message: 'WebGL 2 不可用' }
]

/**
 * 找出现在不正常的关键管线。
 *
 * 只有明确不是 `enabled` 才算问题：`enabled_on` / `enabled_off` 是「开着的，
 * 但当前没用到」，不是故障；`disabled_off_ok` 表示关掉也无所谓，同样不报。
 * 未知状态（Electron 版本换名字）不报——宁可漏报，不要给用户一堆看不懂的警告。
 */
export function gpuProblems(input: unknown): GpuProblem[] {
  if (!input || typeof input !== 'object') return []
  const features = input as Record<string, unknown>
  const problems: GpuProblem[] = []
  for (const { feature, message } of CRITICAL) {
    const raw = features[feature]
    if (typeof raw !== 'string' || raw.length === 0) continue
    const state = raw
    const ok = state === 'enabled' || state === 'enabled_on' || state === 'enabled_off' || state === 'disabled_off_ok'
    if (!ok) problems.push({ feature, state, message })
  }
  return problems
}

/** 给界面用的一句话；没问题时返回空串。 */
export function gpuSummary(input: unknown): string {
  const problems = gpuProblems(input)
  if (problems.length === 0) return ''
  const head = problems[0]
  const rest = problems.length > 1 ? `（另有 ${problems.length - 1} 项）` : ''
  return head.message + rest + ' · ' + head.state
}
