import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { Cdp, listTargets, sleep, waitForDevtools } from 'file:///D:/Aurora/scripts/perf-lib.mjs'

/*
 * 样式快照：把页面上每个元素的计算样式与几何位置记下来。
 *
 * 这是「拆 CSS 之后渲染有没有变」的判据。像素对比只能告诉你「变了」，
 * 计算样式对比能告诉你是哪条规则、哪个属性变了——层叠顺序挪错一段时，
 * 差异往往只有几个元素的 margin 或颜色。
 */
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = Number(process.argv[2] ?? 9411)
const PAGE = process.argv[3] ?? 'file:///D:/Aurora/preview-dist/aurora-preview-songs.html'
const OUT = process.argv[4] ?? 'C:/Users/PC/AppData/Local/Temp/css-snapshot.json'
const child = execFile(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1680,1003', '--remote-debugging-port=' + PORT, PAGE])

const evalJs = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.value
}

try {
  await waitForDevtools(PORT, { timeoutMs: 30000 })
  const targets = await listTargets(PORT)
  const page = targets.find((t) => t.type === 'page')
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl, { callTimeoutMs: 30000 })
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await sleep(2800)
  await evalJs(cdp, "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '稍后再设'); if (b) b.click(); return Boolean(b) })()")
  await sleep(800)
  const snapshot = await evalJs(cdp, `(() => {
    const props = ['display','position','width','height','marginTop','marginBottom','marginLeft','marginRight','paddingTop','paddingBottom','paddingLeft','paddingRight','backgroundColor','color','fontSize','fontWeight','borderRadius','opacity','gap','gridTemplateColumns','flexDirection']
    const rows = []
    for (const el of document.querySelectorAll('*')) {
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      const values = {}
      for (const p of props) values[p] = style[p]
      rows.push({
        path: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
        x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height),
        values
      })
    }
    return JSON.stringify(rows)
  })()`)
  fs.writeFileSync(OUT, snapshot, 'utf8')
  const rows = JSON.parse(snapshot)
  console.log('elements:', rows.length, 'bytes:', fs.statSync(OUT).size)
} catch (error) {
  console.log('FAILED', error.message)
} finally {
  try { child.kill() } catch {}
}
