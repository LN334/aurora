import { execFile } from 'node:child_process'
import { app, net, session } from 'electron'
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
    path.join(app.getPath('userData'), 'frpc')
    /*
     * 故意不搜 C:\Program Files\SakuraFrpLauncher：那里那份 frpc.exe 是启动器
     * 定制版，只允许 SakuraFrp Service 调，被别的程序拉起会直接退出——用它就是
     * 「点开关没反应」的根源。
     */
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

/**
 * 找到的 frpc 能不能真用。
 *
 * 「文件存在」不等于「能跑」：启动器目录里那份就在，但一跑就退。用 --version 试
 * 一次，退出码 0 才算数——不然用户看到的是「点了开关没反应」。
 */
export async function sakuraCheckFrpc(file: string): Promise<{ ok: boolean; message: string }> {
  if (!file) return { ok: false, message: '没找到 frpc，去樱花面板「软件下载」里下独立版' }
  /*
   * 启动器目录里那份要单独挡掉。
   *
   * 它对 --version 是老老实实回版本的，所以「跑一次 --version」验不出问题；
   * 但真去连隧道时会拒绝：「not intended to be run directly」。按路径挡最省事，
   * 也不会误伤用户自己下的那一份。
   */
  if (file.toLowerCase().includes('sakurafrplauncher')) {
    return { ok: false, message: '这份是启动器自带版，用不了；去面板下载独立版 frpc' }
  }
  return await new Promise((resolve) => {
    try {
      execFile(file, ['--version'], { timeout: 8000 }, (error, stdout) => {
        if (error) {
          resolve({ ok: false, message: '这份 frpc 跑不起来（' + (error.message || '退出非零') + '），去面板下载独立版' })
          return
        }
        resolve({ ok: true, message: String(stdout).trim().split('\n')[0] ?? '' })
      })
    } catch (error) {
      resolve({ ok: false, message: 'frpc 调不起来：' + (error instanceof Error ? error.message : String(error)) })
    }
  })
}

/**
 * 从樱花官方的 CDN 下 frpc。
 *
 * 不把 frpc 打进安装包：那份是樱花定制版，随应用再分发没有明确的许可依据。
 * 改成「第一次用时从他们自己的下载站取一份放本机」——用户不用自己去翻页面，
 * 我们也不承担再分发。
 */
const FRPC_URL = 'https://nya.globalslb.net/natfrp/client/frpc/0.51.0-sakura-15.1/frpc_windows_amd64.exe'

export async function sakuraInstallFrpc(): Promise<{ ok: boolean; message: string; path: string }> {
  const dir = path.join(app.getPath('userData'), 'frpc')
  const target = path.join(dir, 'frpc.exe')
  try {
    fs.mkdirSync(dir, { recursive: true })
    const bytes = await download(FRPC_URL)
    if (bytes.length < 1024 * 1024) {
      return { ok: false, message: '下载到的文件太小，可能被拦了', path: '' }
    }
    fs.writeFileSync(target, bytes)
    const check = await sakuraCheckFrpc(target)
    return { ok: check.ok, message: check.ok ? '' : check.message, path: check.ok ? target : '' }
  } catch (error) {
    return { ok: false, message: '下载失败：' + (error instanceof Error ? error.message : String(error)), path: '' }
  }
}

/** 下载成 Buffer。走 Chromium 的网络栈，和查询接口用同一条路。 */
function download(target: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const timer = setTimeout(() => reject(new Error('下载超时')), 90000)
    try {
      const request = net.request({ url: target, method: 'GET', session: session.defaultSession, redirect: 'follow' })
      request.on('response', (response) => {
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          clearTimeout(timer)
          resolve(Buffer.concat(chunks))
        })
        response.on('error', (error) => {
          clearTimeout(timer)
          reject(error)
        })
      })
      request.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      request.end()
    } catch (error) {
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
