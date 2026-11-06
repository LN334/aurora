/*
 * 「动态效果」开关。
 *
 * 这一项不进主进程设置：它只在渲染层生效（CSS 的过渡与动画），存 localStorage
 * 就够，改完立刻生效，也不需要重启。和壁纸的开关同一个思路——主进程只负责它
 * 真正拥有的东西（文件、窗口、网络）。
 */

const KEY = 'aurora.motion.reduced'

export function readReduceMotion(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

/** 挂到 <html> 上，样式表用 .is-reduced-motion 收掉过渡与动画。 */
export function applyReduceMotion(reduced: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('is-reduced-motion', reduced)
}

export function writeReduceMotion(reduced: boolean): void {
  try {
    localStorage.setItem(KEY, reduced ? 'on' : 'off')
  } catch {
    // 存储被禁用时仍然让本次会话生效，只是记不住。
  }
  applyReduceMotion(reduced)
}
