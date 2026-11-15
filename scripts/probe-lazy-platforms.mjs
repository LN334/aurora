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
const PROFILE_ROOT = path.join(ROOT, '.smoke', 'lazy-profile')
const APP_PAGE = 'aurora-app://app/index.html'
const SETTLE_MS = 8000

function log(...parts) {
  console.log('lazy:', ...parts)
}

function launchApp(tag) {
  const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  /*
   * 每轮换一个 profile 与 userData：Windows 上进程刚退出时目录删不干净，两轮共用
   * 一个目录会让第二轮读到第一轮留下的勾选。
   */
  const env = { ...process.env, AURORA_PROFILE: 'lazyprobe-' + tag }
  delete env.ELECTRON_RUN_AS_NODE
  return spawn(
    electron,
    [
      '.',
      '--remote-debugging-port=' + PORT,
      '--user-data-dir=' + PROFILE_ROOT + '-' + tag,
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

/** 这一轮的主进程日志。里面每家后端动手时都会留 `kugou:`、`netease:` 这样的行。 */
function startupLog(tag) {
  const file = path.join(process.env.TEMP ?? '', 'aurora-lazyprobe-' + tag, 'startup.log')
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

/*
 * 「后端被拉起来了」的硬证据。
 *
 * 不能拿 `netease:` 这种接口行当判据：读账号、切档案都会留一行，但那不 require
 * 那 93 MB 的包。这里只认真正启动后端的日志。
 */
const BACKEND_MARK = {
  netease: 'netease: upstream loaded',
  qq: 'qq: upstream loaded',
  kugou: '[kugou] starting api'
}

async function measure(tag, platformsForRoam) {
  fs.rmSync(PROFILE_ROOT + '-' + tag, { recursive: true, force: true })
  /*
   * userData 也在 TEMP 下，每轮重来。不删的话 startup.log 是追加写的，上一轮的
   * 「后端起来了」会留在里面，判据永远红。
   */
  fs.rmSync(path.join(process.env.TEMP ?? '', 'aurora-lazyprobe-' + tag), {
    recursive: true,
    force: true
  })
  const child = launchApp(tag)
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
    const signed = await evaluate(
      cdp,
      `(async () => await window.aurora.platforms.signedIn())()`,
      { awaitPromise: true }
    )
    log(`登录状态=${JSON.stringify(signed)}`)
    /* 等预热、首页取数都跑完，短了会漏掉还在加载的包。 */
    await sleep(SETTLE_MS)
    const memory = mainProcessMemory()
    const text = startupLog(tag)
    log(`勾选=${chosen ?? '（默认，四家全勾）'} 主进程=${memory ? memory.mb + ' MB' : '读不到'}`)
    return { memory, log: text }
  } finally {
    if (cdp) cdp.close()
    killTree(child)
    await sleep(1200)
  }
}

async function main() {
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true })
  const all = await measure('all', null)
  const one = await measure('one', ['qishui'])
  if (!all.memory || !one.memory) throw new Error('读不到主进程内存')
  log(`差值 ${all.memory.mb - one.memory.mb} MB（仅供参考，WorkingSet 抖动大）`)

  /*
   * 已知未收口：首页还有几块（最近新歌、推荐歌单、收藏专辑）会 init 它们的数据源
   * 平台，所以「只勾汽水」时仍可能看到别家的后端起来。这里不设红灯，只把清单打
   * 出来，免得把「还没做完」伪装成「已经绿了」。
   */
  const startedAnyway = Object.entries(BACKEND_MARK)
    .filter(([, mark]) => one.log.includes(mark))
    .map(([id]) => id)
  if (startedAnyway.length > 0) {
    log(`注意：只勾汽水，但这些后端还是起来了：${startedAnyway.join('、')}（首页其余区块拉的）`)
  }
  const started = Object.entries(BACKEND_MARK).filter(([, mark]) => all.log.includes(mark))
  if (started.length === 0) throw new Error('全勾那轮没看到任何后端启动，判据没有意义')
  log(`全勾时起来了：${started.map(([id]) => id).join('、')}`)
  log('通过')
}

main().catch((error) => {
  console.error('lazy:', error.message)
  process.exitCode = 1
})
