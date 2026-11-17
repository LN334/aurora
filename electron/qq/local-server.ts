import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { app } from 'electron'
import { write } from '../startup-log'

/**
 * `electron/qq/smoke.cjs` 用纯 node 跑（`node electron/qq/smoke.cjs`），那时
 * `require('electron')` 给的是可执行文件路径、解构出来的 `app` 是 undefined。这里把它
 * 收成一个显式的可空值，别让「没有 Electron」变成一次崩溃。
 */
const hostApp = app as unknown as
  | { on: (event: string, listener: () => void) => void }
  | undefined

/**
 * QQ 上游（@yakult-green-tea/qq-music-api）是一个 Koa 服务，不像旧包那样是纯函数。
 *
 * 所以这里只管一件事：把那个服务拉起来，拿到它的 baseUrl。所有接口调用在
 * transport.ts 里拼 HTTP 请求，不经过这个文件。
 *
 * 照抄酷狗的那套（electron/kugou/client.ts）：spawn 子进程、现探一个空闲端口、
 * 绑 127.0.0.1、健康检查通过才算起来。
 */

const PACKAGE = '@yakult-green-tea/qq-music-api'
const ENTRY = path.join('dist', 'src', 'app.js')
const READY_TIMEOUT_MS = 25_000
/** 失败后冷却一会儿再重试，免得每次请求都重新拉一次进程。 */
const RETRY_COOLDOWN_MS = 30_000

let child: ChildProcess | null = null
let baseUrl = ''
let booting: Promise<string> | null = null
let failedAt = 0
let cleanupWired = false
let detail = ''

/** 打包后 node_modules 在 asar 里，解包的文件落在 app.asar.unpacked。 */
function realPath(target: string): string {
  const inside = `${path.sep}app.asar${path.sep}`
  const unpacked = `${path.sep}app.asar.unpacked${path.sep}`
  return target.includes(inside) ? target.replace(inside, unpacked) : target
}

function findPackageDir(): string | null {
  const candidates: string[] = []
  const fromEnv = process.env.AURORA_QQ_API_DIR
  if (fromEnv) candidates.push(fromEnv)
  try {
    // app 为 undefined（纯 node）时这里抛 TypeError，下面的 catch 接着走 __dirname 分支。
    candidates.push(path.join(app.getAppPath(), 'node_modules', PACKAGE))
  } catch {
    // app 还没 ready 时没有 appPath，下面的 __dirname 分支兜着
  }
  candidates.push(path.join(__dirname, '..', '..', 'node_modules', PACKAGE))

  for (const candidate of candidates) {
    for (const probe of [candidate, realPath(candidate)]) {
      if (fs.existsSync(path.join(probe, ENTRY))) return probe
    }
  }
  return null
}

/** 让系统给一个空闲端口，不写死 3200。 */
function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('没有拿到空闲端口'))))
    })
  })
}

async function waitReady(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) return false
    try {
      const response = await fetch(`${url}/login/channels`, { signal: AbortSignal.timeout(1500) })
      if (response.ok) return true
    } catch {
      // 还没起来：继续等，不刷日志
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function wireCleanup(): void {
  if (cleanupWired) return
  cleanupWired = true
  hostApp?.on('before-quit', () => stopServer())
  process.on('exit', () => stopServer())
}

async function start(): Promise<string> {
  const dir = findPackageDir()
  if (!dir) {
    detail = '找不到 @yakult-green-tea/qq-music-api'
    write('[qq] api package not found')
    return ''
  }

  let port = 0
  try {
    port = await pickPort()
  } catch (error) {
    detail = '没有可用端口'
    write(`[qq] no free port: ${messageOf(error)}`)
    return ''
  }

  const url = `http://127.0.0.1:${port}`
  // process.execPath 在 Electron 里是 electron.exe；ELECTRON_RUN_AS_NODE 让它按 Node 跑，
  // 这样打包后的机器不需要另装 node。
  const command = process.env.AURORA_QQ_NODE || process.execPath
  const entry = path.join(dir, ENTRY)
  write(`[qq] starting upstream: ${entry} (port=${port})`)

  /*
   * 包里那一行 `app.listen(port)` 绑的是 0.0.0.0，谁在局域网里都能拿本机登录态调接口。
   * 所以不直接跑它的入口，而是自己起一个 `-e` 内联脚本：
   *
   *   NODE_ENV=test  关掉它自己的 listen、自动开浏览器、npm 版本检查三件副作用；
   *   app.js 导出的是 Koa 实例（default），我们拿它自己 listen 到 127.0.0.1。
   *
   * 已验证：NODE_ENV=test 在包内只影响 app.js / openExplorer / updateCheck / logger 四处，
   * 不进任何业务分支。
   */
  const boot = [
    "process.env.NODE_ENV='test'",
    "const app=require(process.env.QQ_API_MAIN).default",
    "const server=app.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('ready'))",
    "server.on('error',(error)=>{console.log('listen-error '+error.message);process.exit(1)})"
  ].join(';')

  let proc: ChildProcess
  try {
    /*
     * 不设 cwd：打包后 `dir` 在 app.asar 里，那对 Node 是个虚拟路径，
     * `spawn` 的 cwd 需要真实目录（实测会让子进程起不来）。而 -e 里的
     * require 用的是绝对路径，本来就不依赖工作目录。
     */
    proc = spawn(command, ['-e', boot], {
      env: {
        ...process.env,
        QQ_API_MAIN: entry,
        PORT: String(port),
        ELECTRON_RUN_AS_NODE: '1'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    detail = `QQ 本地服务起不来：${messageOf(error)}`
    write(`[qq] spawn failed: ${messageOf(error)}`)
    return ''
  }

  child = proc
  // 没有 error 监听时，spawn 失败会以未捕获事件把主进程带走。
  proc.once('error', (error: Error) => {
    detail = `QQ 本地服务起不来：${error.message}`
    write(`[qq] spawn error: ${error.message}`)
    if (child === proc) child = null
  })
  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trimEnd()
    if (text) write(`[qq] ${text}`)
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8').trimEnd()
    if (text) write(`[qq:err] ${text}`)
  })
  proc.once('exit', (code, signal) => {
    if (child === proc) {
      child = null
      baseUrl = ''
      detail = `本地服务退出（code=${code}, signal=${signal ?? 'none'}）`
      write(`[qq] upstream exited: code=${code} signal=${signal ?? 'none'}`)
    }
  })

  wireCleanup()

  const ready = await waitReady(url, READY_TIMEOUT_MS)
  if (!ready) {
    detail = '本地服务 25 秒内没就绪'
    write('[qq] upstream did not become ready')
    stopServer()
    return ''
  }

  baseUrl = url
  detail = ''
  write(`[qq] upstream ready at ${url}`)
  return url
}

/**
 * 拿到本地服务的 baseUrl。没起来就起一次；刚失败过的 30 秒内直接返回空串。
 *
 * 返回空串表示「QQ 这条路现在走不通」，调用方应当退化成明确的失败，别静默重试。
 */
export async function ensureServer(): Promise<string> {
  if (baseUrl) return baseUrl
  if (booting) return booting
  if (failedAt && Date.now() - failedAt < RETRY_COOLDOWN_MS) return ''

  booting = start()
    .then((url) => {
      if (!url) failedAt = Date.now()
      return url
    })
    .catch((error: unknown) => {
      failedAt = Date.now()
      detail = messageOf(error)
      write(`[qq] upstream boot failed: ${detail}`)
      return ''
    })
    .finally(() => {
      booting = null
    })

  return booting
}

/** 已经起来的服务地址；没起来就是空串，不会触发启动。 */
export function serverUrl(): string {
  return baseUrl
}

export function serverDetail(): string {
  return detail
}

export function stopServer(): void {
  const proc = child
  child = null
  baseUrl = ''
  if (!proc || proc.exitCode !== null) return
  try {
    proc.kill()
  } catch (error) {
    write(`[qq] upstream kill failed: ${messageOf(error)}`)
  }
}
