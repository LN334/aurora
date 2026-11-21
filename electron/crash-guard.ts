import fs from 'node:fs'
import path from 'node:path'

/**
 * 崩溃兜底：把上一轮「非正常结束」记下来，下次启动时告诉界面。
 *
 * 为什么不是当场弹窗：进程都崩了，弹窗也跟着没了。PCL 那种「出错时立刻问」
 * 建立在它能接住异常继续跑；我们这边真正要拦的是渲染进程整个挂掉、窗口白屏
 * 的情况，那时唯一还活着的是主进程，它能做的只有把现场写下来。
 *
 * 所以做成两段：
 *  - 出错那一刻，把一句话写进 crash.txt；
 *  - 下次启动读到它，界面上问一句「上次是异常退出的，要不要把日志发我」。
 *
 * 正常退出时会删掉这份文件，所以它存在就等于「上一次没走完」。
 */

let markerPath: string | null = null
const MAX_SUMMARY = 800

function summarise(error: unknown): string {
  if (error instanceof Error) {
    return (error.stack || error.message || String(error)).slice(0, MAX_SUMMARY)
  }
  try {
    return JSON.stringify(error).slice(0, MAX_SUMMARY)
  } catch {
    return String(error).slice(0, MAX_SUMMARY)
  }
}

/**
 * 装上兜底。`report` 用来把这一行也写进 startup.log——两边都要有：
 * 界面上是给用户看的一句话，日志里是给看日志的人看的堆栈。
 */
export function installCrashGuard(
  dir: string,
  report: (line: string) => void
): void {
  try {
    markerPath = path.join(dir, 'crash.txt')
  } catch {
    markerPath = null
  }

  const record = (kind: string, error: unknown): void => {
    const text = '[' + kind + '] ' + summarise(error)
    report('crash ' + text)
    if (!markerPath) return
    try {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true })
      fs.writeFileSync(markerPath, new Date().toISOString() + '\n' + text, 'utf8')
    } catch {
      /* 写不下就算了，崩溃处理本身不能再抛 */
    }
  }

  process.on('uncaughtException', (error) => {
    record('uncaughtException', error)
    /*
     * 未捕获异常之后进程状态已经不可信，继续跑大概率是「界面半死不活」。
     * 记住现场然后退出，比带着坏状态硬撑更好——下次启动会提示要不要发日志。
     */
    setTimeout(() => process.exit(1), 60)
  })

  process.on('unhandledRejection', (reason) => {
    /* Promise 漏接常见于网络请求，通常不影响继续运行，只记录不退出。 */
    record('unhandledRejection', reason)
  })
}

/** 上一次是不是异常退出；是就返回那句话，同时把标记消掉（只提示一次）。 */
export function takeCrashReport(): { at: string; summary: string } | null {
  if (!markerPath) return null
  try {
    const raw = fs.readFileSync(markerPath, 'utf8')
    fs.rmSync(markerPath, { force: true })
    const [at, ...rest] = raw.split('\n')
    return { at: at.trim(), summary: rest.join('\n').trim() }
  } catch {
    return null
  }
}

/** 正常退出时清掉标记，免得下次误报。 */
export function clearCrashMarker(): void {
  if (!markerPath) return
  try {
    fs.rmSync(markerPath, { force: true })
  } catch {
    /* 删不掉也无妨：下次启动多问一句，不会做错事 */
  }
}
