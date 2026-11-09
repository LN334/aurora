/*
 * 首帧体检：把超过 50ms 的长任务记下来，供 --probe 截图时读走。
 *
 * 这段原来是 index.html 里的一段内联 <script>，被页面自己的 CSP（script-src 'self'）
 * 挡掉了，所以打包版里它从来没有跑过。作为第一个 import 放在这里，模块求值仍在
 * 任何渲染之前，观察窗口和以前一样早；观察者本身近乎零开销，回调只在真有长任务
 * 时才跑。
 */
export {}

declare global {
  interface Window {
    __longtasks?: [number, number][]
  }
}

window.__longtasks = []
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__longtasks?.push([Math.round(entry.startTime), Math.round(entry.duration)])
    }
  }).observe({ entryTypes: ['longtask'] })
} catch {
  /* 老内核没有 longtask：空数组就是「这一项没测到」的答案。 */
}
