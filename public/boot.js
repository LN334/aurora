/*
 * 开场动画的点火与收尾。
 *
 * 放在 public/ 而不是打包进 bundle：这段必须在 React 与样式表就位之前跑。
 * 打包进 bundle 的话，第一个可交互的几百毫秒仍然是一块白底——那正是用户说
 * 「启动慢」的那段。
 *
 * 它做两件事：
 *   1. 先把主题落到 <html> 上。浅色的用户不该先看一帧深色界面再翻白。
 *   2. 备好退场。渲染层的首帧画完会调 window.__auroraBootDone()；
 *      渲染层要是抛错没调，这里自己也会在 2.6 秒后走开，绝不把窗口锁死。
 *
 * 入场动画（描边、扫光）不在这里：它已经由 public/splash.html 演过一遍。这一层
 * 只是同一张画面的静态接续，负责盖住「应用页开始加载 → React 首帧」的空白，
 * 所以首帧一到就该走，停留越短越好。
 */
;(function () {
  var root = document.documentElement
  var choice = 'system'
  try {
    choice = localStorage.getItem('aurora.theme') || 'system'
  } catch (error) {
    choice = 'system'
  }
  var light =
    choice === 'light' ||
    (choice !== 'dark' && window.matchMedia('(prefers-color-scheme: light)').matches)
  root.dataset.theme = light ? 'light' : 'dark'

  var el = document.getElementById('boot-splash')
  if (!el) return

  var shown = performance.now()
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  /*
   * 最短停留：只够让这张静态画面被看见。真正的入场动画在 splash.html 里，这里
   * 多待一秒只会让「点开图标到能操作」变长。
   */
  var min = calm ? 120 : 260
  var finished = false

  function dismiss() {
    if (finished) return
    finished = true
    var wait = min - (performance.now() - shown)
    window.setTimeout(
      function () {
        el.classList.add('is-out')
        window.setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el)
        }, 640)
      },
      wait > 0 ? wait : 0
    )
  }

  window.setTimeout(dismiss, 2600)
  window.__auroraBootDone = dismiss
})()
