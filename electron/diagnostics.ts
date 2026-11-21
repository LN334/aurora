import { app, dialog, screen, type BrowserWindow } from 'electron'
import os from 'node:os'
import { scrub } from './pure/log-scrub'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 把诊断日志导成一个文件，让用户能发回来。
 *
 * 用户报问题时，一句「导出日志发我」比让他去找 `%APPDATA%\aurora-player\startup.log`
 * 现实得多——大多数人不知道那个路径，就算知道也未必愿意把一个原始日志直接贴进
 * 公开的 issue。
 *
 * 导出前把所有像凭据的东西替换掉：日志里会出现请求 URL、cookie 名、房间令牌，
 * 这份文件是要拿到外部去的，不能默认用户会自己检查一遍。
 */

/** 日志文件最多带这么多，末尾这些才是出问题那一段。 */
const LOG_TAIL_BYTES = 400 * 1024

function readLogTail(file: string): string {
  try {
    const stat = fs.statSync(file)
    const size = Number(stat.size)
    if (size <= 0) return ''
    const start = Math.max(0, size - LOG_TAIL_BYTES)
    const fd = fs.openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(size, LOG_TAIL_BYTES))
      fs.readSync(fd, buffer, 0, buffer.length, start)
      const body = buffer.toString('utf8')
      // 从中间切开会留下半行，丢掉它。
      const firstBreak = body.indexOf('\n')
      return start > 0 && firstBreak > 0 ? body.slice(firstBreak + 1) : body
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}

/**
 * 这台机器的基本情况。
 *
 * 判断「是不是只有他那儿出问题」时，CPU/内存/显卡/屏幕这几项最常用：软渲染、
 * 显存不足、多屏不同缩放都会让界面表现完全不一样，而这些从日志里看不出来。
 */
async function systemInfo(): Promise<string[]> {
  const lines: string[] = []
  try {
    const cpus = os.cpus()
    if (cpus.length > 0 && cpus[0].model) lines.push(`CPU：${cpus[0].model.trim()} × ${cpus.length}`)
    lines.push(`内存：${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`)
    lines.push(`系统：${os.release()}`)
  } catch {
    /* 读不到就不写 */
  }
  try {
    const info = (await app.getGPUInfo('basic')) as {
      gpuDevice?: Array<{ deviceString?: string }>
    }
    const names = (info.gpuDevice ?? []).map((device) => device.deviceString).filter(Boolean)
    if (names.length > 0) lines.push(`显卡：${names.join(' / ')}`)
  } catch {
    /* 取不到显卡信息是常态（某些驱动不答），不是错误 */
  }
  try {
    const display = screen.getPrimaryDisplay()
    lines.push(`主屏：${display.size.width}×${display.size.height} @${display.scaleFactor}x`)
  } catch {
    /* 无窗口环境 */
  }
  return lines
}

async function header(): Promise<string> {
  const lines = [
    '# Aurora 诊断日志',
    '',
    `导出时间：${new Date().toISOString()}`,
    `版本：${app.getVersion()}`,
    `Electron：${process.versions.electron}`,
    `Chromium：${process.versions.chrome}`,
    `Node：${process.versions.node}`,
    `平台：${process.platform} ${process.arch}`,
    `打包运行：${app.isPackaged ? '是' : '否'}`,
    `数据目录：${app.getPath('userData')}`,
    ...(await systemInfo()),
    ''
  ]
  return lines.join('\n')
}

/**
 * 导出。返回写好的路径；用户取消时返回空串。
 */
export async function exportDiagnostics(window: BrowserWindow | null): Promise<string> {
  const stamp = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const name =
    'aurora-log-' +
    stamp.getFullYear() +
    pad(stamp.getMonth() + 1) +
    pad(stamp.getDate()) +
    '-' +
    pad(stamp.getHours()) +
    pad(stamp.getMinutes()) +
    '.txt'

  /*
   * 有窗口就挂在它上面（对话框居中于窗口），没有就走无父窗口那版。
   *
   * 这两种写法不能合成一句：showSaveDialog 的两个重载第一个参数类型不同，
   * 传 undefined 进「带窗口」那版会被当成选项对象，对话框就不弹了。
   */
  const options = {
    title: '导出诊断日志',
    defaultPath: path.join(app.getPath('downloads'), name),
    filters: [{ name: '文本', extensions: ['txt'] }]
  }
  const target = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (target.canceled || !target.filePath) return ''

  const dir = app.getPath('userData')
  const current = readLogTail(path.join(dir, 'startup.log'))
  const previous = readLogTail(path.join(dir, 'startup.log.1'))
  const blocks: string[] = [await header()]
  /*
   * 上一次运行的日志排在前：用户是遇到问题、重启、然后才来导的，出问题那一段
   * 在上一份里。两份都脱敏——上一份同样是原始运行记录。
   */
  blocks.push(
    previous
      ? '## 上一次运行（startup.log.1，末段，已脱敏）\n\n' + scrub(previous)
      : '## 上一次运行\n\n（没有上一份日志）\n'
  )
  blocks.push(
    current ? '## 这一次运行（startup.log，末段，已脱敏）\n\n' + scrub(current) : '## 这一次运行\n\n（还没有日志内容）\n'
  )
  const content = blocks.join('\n')

  fs.writeFileSync(target.filePath, content, 'utf8')
  return target.filePath
}
