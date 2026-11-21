/** 启动日志。渲染层没跑起来时，这是唯一能留下线索的地方。 */
import fs from 'node:fs'
import path from 'node:path'

let logPath: string | null = null
let usable = false

/** Where the log lives, for the "it is broken, send me this" message. */
export function startupLogPath(): string | null {
  return logPath
}

export function openStartupLog(logDir: string, appVersion: string, packaged: boolean): void {
  try {
    fs.mkdirSync(logDir, { recursive: true })
    logPath = path.join(logDir, 'startup.log')
    /*
     * 把上一次的日志滚成 `startup.log.1`，而不是删掉。
     *
     * 原来每次启动都清空，理由是「要的是这次失败的那一段」——但用户遇到问题
     * 之后干的第一件事往往就是重启，重启这一下就把现场抹掉了。留一份上一次的，
     * 导出时一起带上，才算把「出事那一次」留住。
     *
     * 只留一份：再多就需要提示用户挑哪一份，而前两次运行的日志对判断问题几乎
     * 没有帮助。
     */
    try {
      const previous = logPath + '.1'
      if (fs.existsSync(logPath)) {
        fs.rmSync(previous, { force: true })
        fs.renameSync(logPath, previous)
      }
    } catch {
      /* 滚不动（被占用之类）就照旧清空，日志本身不该拦住启动 */
    }
    fs.writeFileSync(logPath, '', 'utf-8')
    usable = true
    write('aurora startup log')
    write(`version=${appVersion} packaged=${packaged}`)
    write(`node=${process.versions.node} electron=${process.versions.electron} chrome=${process.versions.chrome}`)
    write(`resourcesPath=${process.resourcesPath}`)
    write(`platform=${process.platform} arch=${process.arch}`)
  } catch {
    // A log that cannot be written must not stop the app from starting.
    usable = false
  }
}

/** 同步追加。用 WriteStream 会缓冲，进程被强杀时日志是空的（踩过一次）。 */
export function write(line: string): void {
  if (!usable || !logPath) return
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()}  ${line}\n`, 'utf-8')
  } catch {
    // ignore
  }
}

export function closeStartupLog(): void {
  // Nothing to flush: every line is already on disk. Kept for the call sites that
  // expect a symmetry with `openStartupLog`.
  usable = false
}
