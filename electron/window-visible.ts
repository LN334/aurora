/**
 * 「窗口露没露脸」，主进程比来问 IPC 的人更清楚。
 *
 * netease 上游包第一次 require 要一秒多，而页面一挂载就来要推荐数据：那次
 * require 是同步的，主进程的事件循环会整段被它占住。渲染进程其实早就画完了
 * 首帧（2026-11-26 实测首帧 337ms），`ready-to-show` 却只能排在这次 require
 * 后面，窗口于是白等到 2220ms——用户看到的就是「点开要愣两秒才出画面」。
 *
 * 所以要走上游的那几条 IPC 先在这儿排个队，等窗口真露过脸再动手。等待有上限：
 * 截图模式、或者哪次渲染层起不来导致窗口永远不显示时，最多等这么久就照常干活，
 * 不能把平台功能一起赔进去。
 */
const VISIBLE_TIMEOUT_MS = 4000

let visible = false
let release: (() => void) | null = null

/** 窗口已显示。由 `ready-to-show` 里那次 `show()` 之后调用。 */
export function markWindowVisible(): void {
  if (visible) return
  visible = true
  const pending = release
  release = null
  pending?.()
}

/** 等到窗口露过脸；已经可见就立刻返回。 */
export function whenWindowVisible(timeoutMs = VISIBLE_TIMEOUT_MS): Promise<void> {
  if (visible) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      release = null
      resolve()
    }, timeoutMs)
    release = () => {
      clearTimeout(timer)
      resolve()
    }
  })
}
