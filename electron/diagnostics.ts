import { app, dialog, screen, type BrowserWindow } from 'electron'
import os from 'node:os'
import { partyState } from './party/room'
import { activeBootSteps, formatBootSteps } from './pure/boot-steps'
import { scrub } from './pure/log-scrub'
import { loadSettings } from './settings'
import { signedInPlatforms } from './warmup'
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

/** 目录占用；只看两层、最多数千个文件，够说明问题又不会卡住导出。 */
function directorySize(dir: string): { bytes: number; files: number } {
  let bytes = 0
  let files = 0
  const walk = (current: string, depth: number): void => {
    if (depth > 2 || files > 20000) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      try {
        if (entry.isDirectory()) walk(full, depth + 1)
        else {
          bytes += fs.statSync(full).size
          files += 1
        }
      } catch {
        /* 单个文件读不到不影响总数 */
      }
    }
  }
  walk(dir, 0)
  return { bytes, files }
}

/**
 * 环境快照：排障时最常问的「他那边是什么配置」。
 *
 * 设置整份带上（JSON，已脱敏）——只报一句「版本 0.9.19」没法判断问题是不是
 * 某个开关引起的；带上四家登录状态，才能分清「他根本没登录」和「登录了但接口
 * 出错」；房间状态与缓存大小用来回答「一起听是房主还是客人」「缓存有没有爆」。
 */
function environmentSnapshot(): string[] {
  const lines: string[] = []
  try {
    const settings = JSON.stringify(loadSettings(), null, 2)
    lines.push('## 设置（已脱敏）', '', '```json', scrub(settings), '```', '')
  } catch {
    lines.push('## 设置', '', '（读不到设置文件）', '')
  }
  try {
    const signed = signedInPlatforms()
    const online = Object.entries(signed).filter(([, value]) => value).map(([id]) => id)
    lines.push('## 平台', '', `登录着的：${online.length > 0 ? online.join('、') : '（一个都没有）'}`, '')
  } catch {
    /* 平台状态读不到不致命 */
  }
  try {
    const party = partyState()
    const role = party.role === 'idle' ? '没在房间' : party.role === 'host' ? '房主' : '客人'
    lines.push(
      '## 一起听',
      '',
      `角色：${role}　成员：${party.members.length}　替房间转发音频：${party.relay ? '开' : '关'}　公网地址：${party.publicAddress ? '有' : '无'}　队列：${party.queue.length} 首`,
      ''
    )
  } catch {
    /* 房间模块没起来 */
  }
  try {
    const dir = path.join(app.getPath('userData'), 'media-cache')
    const size = directorySize(dir)
    lines.push('## 缓存', '', `媒体缓存：${(size.bytes / 1048576).toFixed(1)} MB / ${size.files} 个文件`, '')
  } catch {
    /* ignore */
  }
  return lines
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
  blocks.push(environmentSnapshot().join('\n'))
  /*
   * 启动步骤：每一步的相对时刻与间隔。回答「打开慢是慢在哪一段」这类问题，
   * 平铺的日志只能靠时间戳自己减。
   */
  const steps = formatBootSteps(activeBootSteps())
  if (steps) blocks.push('## 本次启动步骤' + '\n\n' + steps)
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
