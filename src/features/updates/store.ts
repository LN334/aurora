import { create } from 'zustand'
import { bridge, isNative } from '../../bridge'
import type { UpdateResult } from '../../env'

/** 兜底的发布页：任何状态都能把人送到这里手动下载。 */
const LATEST_RELEASE = 'https://github.com/LN334/aurora/releases/latest'

/**
 * 更新状态，全应用一份。
 *
 * 应用里不再有更新横幅：有新版本由设置页一条一条走（检查 → 下载 → 重启并安装），
 * 这里存的是那三步共用的状态，设置页读它显示进度。同一份状态也给截图脚本一个推进口。
 */

interface UpdateState {
  /** 最近一次检查或下载的状态；null 表示这次启动还没查过。 */
  result: UpdateResult | null
  /**
   * 有新版本这件事，用户是不是已经去看过了。
   *
   * 左栏那颗点只在「查到了、还没看」时亮：一直亮着会变成噪音，一进设置就灭
   * 又让人还没找到「更新与关于」就丢了线索。所以熄灭的时机定在打开那一格。
   */
  noted: boolean
  /** 检查或下载的请求在飞，按钮该转圈。 */
  busy: boolean
  /** 用户已经打开过更新页，左栏那颗点可以收了。 */
  note(): void
  check(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  open(): Promise<void>
}

/** 每个窗口只接一次主进程的推送。 */
let bound = false

export const useUpdate = create<UpdateState>()((set, get) => ({
  result: null,
  noted: false,
  busy: false,

  note() {
    set({ noted: true })
  },

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

  /**
   * 打开这一版的发布页。
   *
   * 不只是「有新版本」时能用：下载失败也得把人送到一个能手动下载的地方，
   * 否则界面上那句「改用浏览器下载」就落不了地。没有 info 时给最新版兜底。
   */
  async open() {
    if (!isNative) return
    const result = get().result
    const info = result && 'info' in result ? result.info : null
    await bridge.updates.open(info?.url || LATEST_RELEASE)
  },

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
  const apply = (result: UpdateResult): void => {
    useUpdate.setState((state) => ({
      result,
      // 只剩「有新版本」值得盯；一变成 current / downloading 就把点收掉。
      noted: result.state === 'available' ? state.noted : false
    }))
  }
  bridge.updates.onAvailable(apply)
  bridge.updates.onStatus(apply)
}

/**
 * 调试句柄：截图脚本要能把 store 推进某个状态，而不必真发一版。
 * 只影响页面内存，不写盘，也不改主进程的检查结果。
 */
;(window as unknown as Record<string, unknown>).__auroraUpdate = useUpdate
