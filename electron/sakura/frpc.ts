import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 自己找 frpc。
 *
 * 不再让用户填路径：他下载完之后，程序去几个最可能的位置看一眼。找得到就用，
 * 找不到再说「没找到」——让人手抄一个 C:\...\frpc.exe 是最没必要的一步。
 */

const NAMES = ['frpc.exe', 'frpc_windows_amd64.exe', 'frpc_windows_386.exe']

function candidates(): string[] {
  const home = app.getPath('home')
  const dirs = [
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(app.getPath('userData'), 'frpc'),
    'C:\\Program Files\\SakuraFrpLauncher'
  ]
  const out: string[] = []
  for (const dir of dirs) {
    for (const name of NAMES) out.push(path.join(dir, name))
    /* 下载目录里常见带版本号的名字：扫一层目录名里含 frpc 的。 */
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue
        const lower = entry.name.toLowerCase()
        if (lower.startsWith('frpc') && lower.endsWith('.exe')) out.push(path.join(dir, entry.name))
      }
    } catch {
      /* 目录不存在就算了 */
    }
  }
  return out
}

export function sakuraFindFrpc(): string {
  for (const file of candidates()) {
    try {
      if (fs.statSync(file).isFile()) return file
    } catch {
      /* 继续找下一个 */
    }
  }
  return ''
}
