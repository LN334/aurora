/*
 * 一次性测量：把一份内存按进程与用途拆开，作为「下一步压哪儿」的依据。
 *
 * 输出四块：主进程、GPU、渲染、utility 的工作集，以及渲染层的 JS 堆、DOM 节点、
 * 图片张数与它们的自然尺寸总和（解码后的估算）。
 *
 * 用完就该删。
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, killTree, listTargets, sleep, waitForDevtools } from './perf-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9277
const PROFILE = path.join(ROOT, '.smoke', 'mem-profile')
const APP_PAGE = 'aurora-app://app/index.html'
const HASH = process.argv.includes('--home') ? '#home' : '#local'
const SETTLE_MS = 8000

function log(...parts) {
  console.log('mem:', ...parts)
}

function launchApp() {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const env = { ...process.env, AURORA_PROFILE: 'memprobe' }
  delete env.ELECTRON_RUN_AS_NODE
  return spawn(
    electron,
    [
      '.',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE,
      '--disable-features=CalculateNativeWinOcclusion'
    ],
    { cwd: ROOT, env, stdio: 'ignore' }
  )
}

async function connect() {
  await waitForDevtools(PORT)
  const targets = await listTargets(PORT)
  const page = targets.find((target) => target.type === 'page')
  if (!page) throw new Error('没有页面 target')
  return Cdp.connect(page.webSocketDebuggerUrl)
}

async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '求值失败')
  }
  return result.result.value
}

async function waitUntil(cdp, expression, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(cdp, `!!(${expression})`)) return
    await sleep(250)
  }
  throw new Error('等不到 ' + label)
}

/** 按 --type= 把本实例的进程分门别类，返回 { kind: workingSetMB }。 */
function processMemory() {
  /*
   * 子进程的命令行不一定带 --user-data-dir，所以先按它认出主进程，再收它的孩子。
   */
  const script = [
    `$all = Get-CimInstance Win32_Process -Filter "Name='electron.exe'";`,
    `$main = $all | Where-Object { $_.CommandLine -like '*mem-profile*' -and $_.CommandLine -notlike '*--type=*' } | Select-Object -First 1;`,
    `if (-not $main) { return };`,
    `$rows = $all | Where-Object { $_.ProcessId -eq $main.ProcessId -or $_.ParentProcessId -eq $main.ProcessId };`,
    `foreach ($row in $rows) {`,
    `  $kind = 'browser';`,
    `  if ($row.CommandLine -match '--type=([a-z-]+)') { $kind = $Matches[1] };`,
    `  '{0} {1}' -f $kind, $row.WorkingSetSize`,
    `}`
  ].join(' ')
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8'
  }).trim()
  const totals = new Map()
  for (const line of out.split(/\r?\n/)) {
    const [kind, bytes] = line.trim().split(/\s+/)
    if (!kind || !bytes) continue
    totals.set(kind, (totals.get(kind) ?? 0) + Number(bytes))
  }
  const mb = {}
  for (const [kind, bytes] of totals) mb[kind] = Math.round(bytes / 1024 / 1024)
  return mb
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true })
  const child = launchApp()
  let cdp = null
  try {
    cdp = await connect()
    if (!(await evaluate(cdp, `location.href.startsWith('aurora-app://')`))) {
      await cdp.send('Page.navigate', { url: APP_PAGE + HASH })
    } else {
      await evaluate(cdp, `location.hash = '${HASH}'`)
    }
    await waitUntil(cdp, `document.querySelector('.rail')`, '外壳')
    await sleep(SETTLE_MS)

    await cdp.send('Performance.enable')
    const metrics = await cdp.send('Performance.getMetrics')
    const metric = (name) => metrics.metrics.find((item) => item.name === name)?.value ?? 0

    const dom = await evaluate(
      cdp,
      `(() => {
        const imgs = [...document.images]
        return {
          href: location.hash,
          nodes: document.querySelectorAll('*').length,
          images: imgs.length,
          decodedPx: imgs.reduce((sum, img) => sum + (img.naturalWidth * img.naturalHeight || 0), 0),
          canvases: document.querySelectorAll('canvas').length,
          backdrops: [...document.querySelectorAll('*')].filter((el) => {
            const style = getComputedStyle(el)
            return style.backdropFilter && style.backdropFilter !== 'none'
          }).length,
          glass: [...document.querySelectorAll('*')].filter((el) => {
            const style = getComputedStyle(el)
            return style.filter && style.filter.includes('blur')
          }).length
        }
      })()`
    )

    log('页面', JSON.stringify({ href: dom.href, nodes: dom.nodes, images: dom.images }))
    log(
      '渲染层',
      JSON.stringify({
        jsHeapMB: Math.round(metric('JSHeapUsedSize') / 1024 / 1024),
        documents: metric('Documents'),
        nodes: metric('Nodes'),
        imagePx: Math.round(dom.decodedPx / 1e6) + ' MPx',
        canvases: dom.canvases,
        backdropFiltered: dom.backdrops,
        blurred: dom.glass
      })
    )
    log('进程工作集 MB', JSON.stringify(processMemory()))
  } finally {
    if (cdp) cdp.close()
    killTree(child)
  }
}

main().catch((error) => {
  console.error('mem:', error.message)
  process.exitCode = 1
})
