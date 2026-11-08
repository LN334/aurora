import { create } from 'zustand'
import { bridge, isNative } from '../../bridge'
import type { UpdateResult } from '../../env'

/**
 * 更新状态，全应用一份。
 *
 * 设置页原来自己拿一份（UpdatePanel 里的 useState），于是「有新版本」这件事
 * 只有打开设置页才看得见。横幅、设置页、下载进度现在读同一个 store：谁先
 * 知道都算数，也不会出现「设置页说在下载、主界面还让我下载」。
 */

interface UpdateState {
  /** 最近一次检查或下载的状态；null 表示这次启动还没查过。 */
  result: UpdateResult | null
  /** 用户关掉通知的那个版本。同一版本在本次启动内不再打扰。 */
  dismissedVersion: string | null
  /** 检查或下载的请求在飞，按钮该转圈。 */
  busy: boolean
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  open(): Promise<void>
  dismiss(): void
}

/** 每个窗口只接一次主进程的推送。 */
let bound = false

export const useUpdate = create<UpdateState>()((set, get) => ({
  result: null,
  dismissedVersion: null,
  busy: false,

  async check() {
    if (!isNative || get().busy) return
    set({ busy: true })
    try {
      set({ result: await bridge.updates.check() })
    } finally {
      set({ busy: false })
    }
  },

  async download() {
    if (!isNative || get().busy) return
    set({ busy: true })
    try {
      await bridge.updates.download()
    } finally {
      set({ busy: false })
    }
  },

  async install() {
    if (!isNative) return
    await bridge.updates.install()
  },

  async open() {
    const result = get().result
    if (!isNative || !result) return
    if (result.state === 'current' || result.state === 'unconfigured' || result.state === 'error') return
    await bridge.updates.open(result.info.url)
  },

  dismiss() {
    const result = get().result
    if (!result || result.state === 'current' || result.state === 'unconfigured' || result.state === 'error') {
      set({ dismissedVersion: null })
      return
    }
    set({ dismissedVersion: result.info.version })
  }
}))

/**
 * 接主进程的两条推送。
 *
 * onAvailable 是启动时那次静默检查的结果，只发一次；onStatus 是之后下载与
 * 安装的每一次状态变化（0% → 100% → ready）。两者都写进同一个 result，因为
 * 对界面来说它们回答的是同一个问题。
 */
export function bindUpdateEvents(): void {
  if (bound || !isNative) return
  bound = true
  bridge.updates.onAvailable((result) => useUpdate.setState({ result }))
  bridge.updates.onStatus((result) => useUpdate.setState({ result }))
}

/**
 * 调试句柄：截图脚本要能把 store 推进某个状态，而不必真发一版。
 * 只影响页面内存，不写盘，也不改主进程的检查结果。
 */
;(window as unknown as Record<string, unknown>).__auroraUpdate = useUpdate
