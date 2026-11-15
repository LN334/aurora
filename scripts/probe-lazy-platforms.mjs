/*
 * 一次性验收：只勾一家平台时，另外几家的 SDK 到底有没有进主进程。
 *
 * 做法是同一台机器跑两轮：第一轮不碰设置（默认四家全勾），第二轮把
 * aurora.roam.platforms 改成 ['qishui']，各等首屏 + 8 秒，读主进程的
 * WorkingSetSize 做对照。判据只看差值——主进程里那 90 多 MB 要么在，要么不在。
 *
 * 用完就该删。
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Cdp, killTree, listTargets, sleep, waitForDevtools } from './perf-lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 9276
const PROFILE = path.join(ROOT, '.smoke', 'lazy-profile')
const APP_PAGE = 'aurora-app://app/index.html'
const SETTLE_MS = 8000

function log(...parts) {
  console.log('lazy:', ...parts)
}

function launchApp() {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  const env = { ...process.env, AURORA_PROFILE: 'lazyprobe' }
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

/** 主进程 = 没有 --type 参数的那个 electron.exe。 */
function mainProcessMemory() {
  const script = [
    `$rows = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*lazy-profile*' };`,
    `$main = $rows | Where-Object { $_.CommandLine -notlike '*--type=*' };`,
    `foreach ($row in $main) { '{0} {1}' -f $row.ProcessId, $row.WorkingSetSize }`
  ].join(' ')
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8'
  }).trim()
  if (!out) return null
  const [pid, bytes] = out.split(/\s+/)
  return { pid: Number(pid), mb: Math.round(Number(bytes) / 1024 / 1024) }
}

async function measure(platformsForRoam) {
  fs.rmSync(PROFILE, { recursive: true, force: true })
  const child = launchApp()
  let cdp = null
  try {
    cdp = await connect()
    if (!(await evaluate(cdp, `location.href.startsWith('aurora-app://')`))) {
      await cdp.send('Page.navigate', { url: APP_PAGE })
    }
    await waitUntil(cdp, `document.querySelector('.rail')`, '外壳')
    if (platformsForRoam) {
      await evaluate(
        cdp,
        `localStorage.setItem('aurora.roam.platforms', ${JSON.stringify(JSON.stringify(platformsForRoam))})`
      )
      await cdp.send('Page.reload')
      await sleep(1500)
      cdp.close()
      cdp = await connect()
      await waitUntil(cdp, `document.querySelector('.rail')`, '重载后的外壳')
    }
    const chosen = await evaluate(cdp, `localStorage.getItem('aurora.roam.platforms')`)
    /* 等预热、首页取数都跑完，短了会漏掉还在加载的包。 */
    await sleep(SETTLE_MS)
    const memory = mainProcessMemory()
    log(`勾选=${chosen ?? '（默认，四家全勾）'} 主进程=${memory ? memory.mb + ' MB' : '读不到'}`)
    return memory
  } finally {
    if (cdp) cdp.close()
    killTree(child)
    await sleep(1200)
  }
}

async function main() {
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true })
  const all = await measure(null)
  const one = await measure(['qishui'])
  if (!all || !one) throw new Error('读不到主进程内存')
  const saved = all.mb - one.mb
  log(`差值 ${saved} MB`)
  /*
   * 网易云那家包实测常驻约 93 MB。只勾汽水时它不该被 require，所以差值应该
   * 落在几十 MB 量级；太小说明还有别的地方把包拉起来了。
   */
  if (saved < 40) throw new Error(`只勾一家时主进程没瘦下来（${saved} MB）`)
  log('通过')
}

main().catch((error) => {
  console.error('lazy:', error.message)
  process.exitCode = 1
})
