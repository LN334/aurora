/**
 * 量一个正在跑的 Aurora 渲染进程：JS 堆、DOM 计数与图片解码内存。
 * 用法：node scripts/probe-mem.mjs <debugPort> [settleMs] [navText]
 */
import { Cdp, listTargets, waitForDevtools, sleep } from './perf-lib.mjs'

const port = Number(process.argv[2] ?? 9333)
const settleMs = Number(process.argv[3] ?? 1500)
const navText = process.argv[4] ?? null

await waitForDevtools(port, { timeoutMs: 40000 })
await sleep(settleMs)
const targets = await listTargets(port)
const pages = targets.filter((t) => t.type === 'page')
if (!pages.length) {
  console.error('no page target: ' + JSON.stringify(targets.map((t) => t.url)))
  process.exit(2)
}
const page = pages.find((t) => /aurora-app:|index\.html/i.test(t.url)) ?? pages[0]
const cdp = await Cdp.connect(page.webSocketDebuggerUrl, { callTimeoutMs: 20000 })
await cdp.send('Runtime.enable')
await cdp.send('Performance.enable')

if (navText) {
  const clicked = await cdp.eval(`(() => {
    const want = ${JSON.stringify(navText)}
    const leaves = [...document.querySelectorAll('*')].filter(
      (e) => e.children.length === 0 && (e.textContent || '').trim() === want
    )
    const el = leaves[leaves.length - 1]
    if (!el) return 'not-found:' + [...document.querySelectorAll('.rail *')].filter(e=>e.children.length===0).map(e=>e.textContent.trim()).filter(Boolean).slice(0,20).join('|')
    let node = el
    while (node && node !== document.body) {
      if (node.tagName === 'BUTTON' || node.tagName === 'A' || node.getAttribute('role') === 'button') { node.click(); return 'ok:' + node.tagName }
      node = node.parentElement
    }
    el.click()
    return 'raw'
  })()`)
  console.log(JSON.stringify({ clicked }))
  await sleep(9000)
}

const facts = await cdp.eval(`(() => {
  const imgs = Array.from(document.images)
  let loaded = 0, pixels = 0
  const samples = []
  for (const img of imgs) {
    if (!img.complete || !img.naturalWidth) continue
    loaded += 1
    pixels += img.naturalWidth * img.naturalHeight
    if (samples.length < 8) {
      const r = img.getBoundingClientRect()
      samples.push([img.naturalWidth, Math.round(r.width)])
    }
  }
  return {
    hash: location.hash,
    title: (document.querySelector('.main__head h1, h1') || {}).textContent || null,
    nodes: document.getElementsByTagName('*').length,
    imgs: imgs.length,
    imgsLoaded: loaded,
    decodedMP: +(pixels / 1e6).toFixed(1),
    decodedEstMB: +((pixels * 4) / 1048576).toFixed(1),
    rows: document.querySelectorAll('.trk').length,
    canvases: document.querySelectorAll('canvas').length,
    samples
  }
})()`)

const metrics = await cdp.send('Performance.getMetrics')
const metric = (name) => metrics.metrics.find((m) => m.name === name)?.value ?? null

console.log(
  JSON.stringify(
    {
      jsHeapUsedMB: +(metric('JSHeapUsedSize') / 1048576).toFixed(1),
      jsHeapTotalMB: +(metric('JSHeapTotalSize') / 1048576).toFixed(1),
      nodes: metric('Nodes'),
      listeners: metric('JSEventListeners'),
      layoutCount: metric('LayoutCount'),
      page: facts
    },
    null,
    2
  )
)
cdp.close()
process.exit(0)
