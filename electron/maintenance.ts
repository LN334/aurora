import { app, session } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { CACHE_DIRS, cacheBytes, directoryBytes } from './settings'

const run = promisify(execFile)

/**
 * 释放内存与清理垃圾。
 *
 * 对应 PCL2 百宝箱里那两件事，做法取的是 Windows 上真正有效的那一种：
 * 「释放内存」对每个进程调 psapi 的 EmptyWorkingSet（把暂时不用的物理页交还系统，
 * 页面本身还在，只是下次访问要重新缺页换入）；「清理垃圾」只删可再生数据，
 * 而且要删的目录全部来自 app.getPath，不存在把外部路径传进来的入口。
 *
 * 关于「为什么点了清理数字不降」：Chromium 运行期间一直握着磁盘缓存与 GPU 缓存
 * 的文件句柄，Windows 不允许删除被打开的文件，直接 rm 一定失败。所以顺序是
 * 先让 Chromium 自己把 HTTP 缓存和 V8 代码缓存清掉（session.clearCache /
 * clearCodeCaches，这两步在它内部执行，删得掉），再去删目录；仍然删不掉的
 * 记进 junk-pending.json，由下一次启动在最早期再删一次 —— 那时窗口还没建，
 * 那些文件还没被打开。
 */

export interface MemoryRelease {
  /** 各进程工作集一共让出多少字节。 */
  freedBytes: number
  /** 真正清理成功的进程数。 */
  processes: number
}

export type JunkId = 'cache' | 'logs' | 'crashes'

export interface JunkPart {
  id: JunkId
  label: string
  /** 占用字节；null 表示这个位置测不到（目录不存在或无权限）。 */
  bytes: number | null
}

export interface JunkScan {
  parts: JunkPart[]
  totalBytes: number
  /**
   * 这次清理里有多少字节暂时删不掉，已排进下次启动的清单。
   *
   * 只由 `sweepJunk` 填；`scanJunk` 永远是 0。缓存那一类必然走到这里：
   * GPU 缓存被 Chromium 一直打开，运行时删不掉。
   */
  deferredBytes: number
  /**
   * 这次清理实际让占用下降了多了字节（清理前后两次测量之差）。
   *
   * Windows 允许删除「被其它进程以共享删除方式打开」的文件：unlink 成功，
   * 但空间要等持有句柄的进程关闭文件才真正归还，这时前后测量可能一样大。
   * 所以把「删了多少」单独量出来给界面说，而不是让用户盯着一个没变的数字。
   */
  cleanedBytes: number
}

const JUNK_LABELS: Record<JunkId, string> = {
  cache: '缓存',
  logs: '日志',
  crashes: '崩溃转储'
}

/** 待删清单：本次删不掉、留给下次启动的路径。 */
interface PendingJunk {
  files: string[]
  dirs: string[]
}

const PENDING_FILE = 'junk-pending.json'

function pendingPath(): string {
  return path.join(app.getPath('userData'), PENDING_FILE)
}

async function readPending(): Promise<PendingJunk> {
  try {
    const raw = await fs.promises.readFile(pendingPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PendingJunk>
    return {
      files: Array.isArray(parsed.files) ? parsed.files.filter((item): item is string => typeof item === 'string') : [],
      dirs: Array.isArray(parsed.dirs) ? parsed.dirs.filter((item): item is string => typeof item === 'string') : []
    }
  } catch {
    return { files: [], dirs: [] }
  }
}
async function writePending(pending: PendingJunk): Promise<void> {
  if (pending.files.length === 0 && pending.dirs.length === 0) {
    try {
      await fs.promises.rm(pendingPath(), { force: true })
    } catch {
      /* 没有清单可写就是目标状态，删不掉也无所谓 */
    }
    return
  }
  try {
    await fs.promises.writeFile(pendingPath(), JSON.stringify(pending), 'utf8')
  } catch (error) {
    console.error('[aurora] could not record the deferred cleanup', error)
  }
}

/** 本应用的进程号：主进程加上 Electron 报告的每一个进程。 */
function appPids(): number[] {
  const pids = new Set<number>([process.pid])
  try {
    for (const metric of app.getAppMetrics()) {
      if (typeof metric.pid === 'number' && metric.pid > 0) pids.add(metric.pid)
    }
  } catch {
    /* 拿不到进程列表时，至少还能清主进程自己 */
  }
  return [...pids]
}

/**
 * 让 PowerShell 直接调 EmptyWorkingSet。
 *
 * Node 没有这个系统调用，而 Windows 上能真正把工作集交还系统的动作只有它：
 * 设置进程配额或用 .NET 的 MinWorkingSet 都只是改阈值，不减当前占用。
 */
function trimScript(pids: number[]): string {
  const list = pids.join(',')
  return [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    "$code = '[DllImport(\"psapi.dll\")] public static extern bool EmptyWorkingSet(IntPtr hProcess);'",
    '$fn = Add-Type -MemberDefinition $code -Name WorkingSet -Namespace Aurora -PassThru',
    '$freed = [int64]0',
    '$seen = 0',
    'foreach ($id in @(' + list + ')) {',
    '  try {',
    '    $proc = Get-Process -Id $id -ErrorAction Stop',
    '    $before = $proc.WorkingSet64',
    '    [void]$fn::EmptyWorkingSet($proc.Handle)',
    '    $proc.Refresh()',
    '    $after = $proc.WorkingSet64',
    '    if ($before -gt $after) { $freed += ($before - $after) }',
    '    $seen += 1',
    '  } catch { }',
    '}',
    'Write-Output ("freed=" + $freed)',
    'Write-Output ("procs=" + $seen)'
  ].join('\n')
}

export async function releaseMemory(): Promise<MemoryRelease> {
  const pids = appPids()
  if (pids.length === 0) return { freedBytes: 0, processes: 0 }

  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', trimScript(pids)],
      { timeout: 20_000, windowsHide: true, maxBuffer: 1024 * 1024 }
    )
    const freedBytes = Number(/freed=(\d+)/.exec(stdout)?.[1] ?? 0)
    const processes = Number(/procs=(\d+)/.exec(stdout)?.[1] ?? 0)
    return {
      freedBytes: Number.isFinite(freedBytes) ? freedBytes : 0,
      processes: Number.isFinite(processes) ? processes : 0
    }
  } catch (error) {
    console.error('[aurora] could not trim the working set', error)
    return { freedBytes: 0, processes: 0 }
  }
}
/** userData 根目录下的 *.log，加上子目录 logs/。 */
async function logsTargets(): Promise<{ files: string[]; dirs: string[] }> {
  const root = app.getPath('userData')
  const files: string[] = []
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.log')) {
        files.push(path.join(root, entry.name))
      }
    }
  } catch {
    /* 目录读不到就是没有可删的 */
  }
  return { files, dirs: [path.join(root, 'logs')] }
}

function cacheTargets(): { files: string[]; dirs: string[] } {
  const root = app.getPath('userData')
  return { files: [], dirs: CACHE_DIRS.map((name) => path.join(root, name)) }
}

function crashTargets(): { files: string[]; dirs: string[] } {
  return { files: [], dirs: [app.getPath('crashDumps')] }
}

async function targetsFor(id: JunkId): Promise<{ files: string[]; dirs: string[] }> {
  if (id === 'cache') return cacheTargets()
  if (id === 'logs') return await logsTargets()
  return crashTargets()
}

/**
 * 让 Chromium 自己松手。
 *
 * 这两步在渲染进程/网络服务内部执行，磁盘上的缓存文件由它自己删，
 * 不经过 Windows 的文件锁，所以立刻见效；之后再去删剩下的目录才有机会成功。
 */
async function releaseChromiumCaches(): Promise<void> {
  try {
    const ses = session.defaultSession
    await ses.clearCache()
    await ses.clearCodeCaches({})
    await ses.clearStorageData({ storages: ['shadercache', 'cachestorage', 'serviceworkers'] })
  } catch (error) {
    console.error('[aurora] the renderer kept its cache open', error)
  }
}

async function removeTargets(targets: { files: string[]; dirs: string[] }): Promise<{
  files: string[]
  dirs: string[]
}> {
  const leftFiles: string[] = []
  const leftDirs: string[] = []
  for (const file of targets.files) {
    try {
      await fs.promises.rm(file, { force: true })
    } catch {
      leftFiles.push(file)
    }
  }
  for (const dir of targets.dirs) {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 120 })
    } catch {
      leftDirs.push(dir)
    }
  }
  return { files: leftFiles, dirs: leftDirs }
}

async function crashesBytes(): Promise<number | null> {
  const dir = app.getPath('crashDumps')
  // 目录不存在 == 没有崩溃转储，算 0；测不到（读不了）才返回 null。
  if (!fs.existsSync(dir)) return 0
  try {
    return await directoryBytes(dir)
  } catch {
    return null
  }
}
export async function scanJunk(): Promise<JunkScan> {
  const [cache, logs, crashes] = await Promise.all([cacheBytes(), logsTargets(), crashesBytes()])
  let logsBytes: number | null = 0
  for (const file of logs.files) {
    try {
      logsBytes = (logsBytes ?? 0) + (await fs.promises.stat(file)).size
    } catch {
      /* 正在写的日志可能刚好被替换，忽略这一条 */
    }
  }
  const nestedLogs = await directoryBytes(logs.dirs[0])
  if (nestedLogs !== null) logsBytes = (logsBytes ?? 0) + nestedLogs

  const parts: JunkPart[] = [
    { id: 'cache', label: JUNK_LABELS.cache, bytes: cache },
    { id: 'logs', label: JUNK_LABELS.logs, bytes: logsBytes },
    { id: 'crashes', label: JUNK_LABELS.crashes, bytes: crashes }
  ]
  const totalBytes = parts.reduce((sum, part) => sum + (part.bytes ?? 0), 0)
  return { parts, totalBytes, deferredBytes: 0, cleanedBytes: 0 }
}

/**
 * 删除选中的垃圾，然后重新量一遍。
 *
 * 只接受三个已知的 id：调用方不能借着这个接口删别的东西。
 * 删不掉的路径记进 pending 清单，下一次启动再试。
 */
export async function sweepJunk(ids: unknown): Promise<JunkScan> {
  const wanted = new Set<JunkId>()
  if (Array.isArray(ids)) {
    for (const id of ids) {
      if (id === 'cache' || id === 'logs' || id === 'crashes') wanted.add(id)
    }
  }
  if (wanted.size === 0) return scanJunk()

  const before = await scanJunk()

  if (wanted.has('cache')) await releaseChromiumCaches()

  const leftover: PendingJunk = { files: [], dirs: [] }
  for (const id of wanted) {
    if (id === 'cache') {
      /*
       * GPU 缓存不在这里删。
       *
       * Chromium 用共享删除方式打开 GrShaderCache / GPUCache 一类的文件：unlink
       * 会返回成功，可空间要等它关闭句柄才归还，而它运行期间不会关 —— 实测
       * 清理前后两次测量一个字节都不差，删了等于白删。这些目录统一排进下面
       * 的清单，由下一次启动在最早期删（那时窗口还没建、文件还没被打开）。
       */
      leftover.dirs.push(...cacheTargets().dirs)
      continue
    }
    const left = await removeTargets(await targetsFor(id))
    leftover.files.push(...left.files)
    leftover.dirs.push(...left.dirs)
  }

  const pending = await readPending()
  const merged: PendingJunk = {
    files: [...new Set([...pending.files, ...leftover.files])],
    dirs: [...new Set([...pending.dirs, ...leftover.dirs])]
  }
  await writePending(merged)

  /*
   * 「下次启动再清」只报缓存那一类，而且报的是**清理之后**还占着多少。
   *
   * 早先的写法是把 leftover 目录逐个再量一遍，结果和「已清理」互相打架：
   * 同一批字节既算清掉了又算还没清。缓存是唯一被推迟的一类，直接取清完
   * 之后的缓存总量，两个数字就互为补数（已清理 + 下次再清 ≈ 清理前合计）。
   */
  // 让 Chromium 有时间把刚删掉的名字真正放掉，再量第二次。
  await new Promise((resolve) => setTimeout(resolve, 400))
  const after = await scanJunk()
  const cleanedBytes = Math.max(0, before.totalBytes - after.totalBytes)
  const deferredBytes = wanted.has('cache')
    ? (after.parts.find((part) => part.id === 'cache')?.bytes ?? 0)
    : 0
  return { ...after, deferredBytes, cleanedBytes }
}

/**
 * 启动时先清一次上次没删掉的垃圾。
 *
 * 在创建窗口之前调用：那时 Chromium 还没打开那些缓存文件，删除才能成功。
 * 失败的路径继续留在清单里，下次再试 —— 这里不抛错，清垃圾不该拦住启动。
 */
export async function sweepPendingJunk(): Promise<void> {
  const pending = await readPending()
  if (pending.files.length === 0 && pending.dirs.length === 0) return
  const left = await removeTargets(pending)
  await writePending(left)
  if (left.files.length > 0 || left.dirs.length > 0) {
    console.error('[aurora] some junk is still in use at startup', left.files.length + left.dirs.length)
  }
}