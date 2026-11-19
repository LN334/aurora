import { BrowserWindow, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * 登录过程的记录。
 *
 * 「登录没用」这种反馈没法靠猜：不知道登录后落在哪一页、页面上有什么、候选串
 * 长什么样。所以把每一次观察写进一个文本文件——只记形状（长度、前四位），
 * 不记完整密钥。
 */
function note(line: string): void {
  try {
    const file = path.join(app.getPath('userData'), 'sakura-login.log')
    fs.appendFileSync(file, new Date().toISOString() + '  ' + line + '\n', 'utf8')
  } catch {
    /* 记不下来不影响登录 */
  }
}

function shape(value: string): string {
  return value.length + ':' + value.slice(0, 4) + '…'
}

/**
 * 樱花登录。
 *
 * 「不要手动复制访问密钥」——所以不能只给一颗「打开面板」的按钮，让人自己
 * 去找密钥再粘回来。这里开一扇内嵌登录窗，登录完成后在同一会话里把密钥捞出来，
 * 直接填进 Aurora。
 *
 * 捞法有两路，按确定性从高到低：
 *   1. 用登录后的 cookie 调 /v4/user/info，接口若回访问密钥就直接用；
 *   2. 退而求其次，在账号设置页里按 32 位十六进制的形状找一遍。
 * 两路都拿不到就明确说「没找到」，不假装成功、也不让用户猜。
 */

const TOKEN_SHAPE = /\b[0-9a-f]{32}\b/i
const SETTINGS_URL = 'https://www.natfrp.com/user/settings'
const HOME_URL = 'https://www.natfrp.com/user/'

let loginWindow: BrowserWindow | null = null

/** 从接口拿：登录态在 cookie 里，和网页共用同一个 session。 */
async function tokenFromApi(partitionSession: Electron.Session): Promise<{ token: string; detail: string }> {
  const endpoints = [
    'https://api.natfrp.com/v4/user/info',
    'https://api.natfrp.com/v4/user',
    'https://api.natfrp.com/v4/account'
  ]
  const tried: string[] = []
  for (const url of endpoints) {
    try {
      const response = await partitionSession.fetch(url, { headers: { Accept: 'application/json' } })
      const text = await response.text()
      let body: { code?: number; msg?: string; data?: unknown } | null = null
      try {
        body = JSON.parse(text) as { code?: number; msg?: string; data?: unknown }
      } catch {
        tried.push(url.split('/v4/')[1] + ' 非 JSON')
        continue
      }
      if (!body || body.code !== 0) {
        tried.push(url.split('/v4/')[1] + ' → ' + (body?.msg ?? 'code ' + body?.code))
        continue
      }
      const record = (body.data ?? {}) as Record<string, unknown>
      for (const key of ['token', 'access_token', 'accessToken', 'api_token']) {
        const value = record[key]
        if (typeof value === 'string' && TOKEN_SHAPE.test(value)) return { token: value, detail: '' }
      }
      /* 接口通了但没有密钥字段：把顶层字段名记下来，下次就知道该去哪儿找。 */
      tried.push(url.split('/v4/')[1] + ' 有响应但无密钥字段：' + Object.keys(record).slice(0, 8).join(','))
    } catch (error) {
      tried.push(url.split('/v4/')[1] + ' 连不上')
      void error
    }
  }
  return { token: '', detail: tried.join(' · ') }
}

/**
 * 挨个走候选页找访问密钥。
 *
 * 不知道它在哪一页（设置 / 资料 / 安全 / 令牌），也不值得让用户去翻——登录之后
 * 把这几页都走一遍，谁有就记谁。每一步的页面文本都写进日志，下次就不用再猜。
 */
const CANDIDATES = ['user/settings', 'user/profile', 'user/security', 'user/token', 'user']
const TOKEN_ANY = /\b(?:[0-9a-f]{32}|[A-Za-z0-9_-]{32,64})\b/

async function sweepPages(win: BrowserWindow, note: (line: string) => void): Promise<string> {
  const original = win.webContents.getURL()
  for (const page of CANDIDATES) {
    try {
      await win.loadURL('https://www.natfrp.com/' + page)
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const body = String(await win.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true))
      const flat = body.replace(/\s+/g, ' ')
      note('sweep ' + page + ' → ' + flat.slice(0, 200))
      /* 认「访问密钥」这几个字附近的那一串，比全页盲扫准。 */
      const near = /访问密钥[^A-Za-z0-9]{0,40}([A-Za-z0-9_-]{16,64})/.exec(body)
      if (near) return near[1]
      const any = TOKEN_ANY.exec(body)
      if (any) return any[0]
    } catch (error) {
      note('sweep ' + page + ' 失败 ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  try {
    await win.loadURL(original)
  } catch {
    /* 回不去就算了 */
  }
  return ''
}

/** 从页面里找：设置页把密钥渲染在页面上，按形状捞一次。 */
async function tokenFromPage(win: BrowserWindow): Promise<string> {
  try {
    const text = await win.webContents.executeJavaScript(
      "document.body ? document.body.innerText : ''",
      true
    )
    const match = String(text).match(TOKEN_SHAPE)
    return match ? match[0] : ''
  } catch {
    return ''
  }
}

interface SakuraLoginResult {
  ok: boolean
  token: string
  message: string
}

/**
 * 打开登录窗。返回的 Promise 在窗口关闭或拿到密钥时结算。
 *
 * 拿不到就返回 ok:false 与原因——不弹二次确认，也不把「可能有」当成「有」。
 */
export async function sakuraLogin(): Promise<SakuraLoginResult> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return { ok: false, token: '', message: '登录窗口已经开着' }
  }

  const partition = session.fromPartition('persist:sakura')
  loginWindow = new BrowserWindow({
    width: 520,
    height: 720,
    title: '登录樱花',
    backgroundColor: '#10141a',
    autoHideMenuBar: true,
    webPreferences: {
      session: partition,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const win = loginWindow
  return await new Promise<SakuraLoginResult>((resolve) => {
    let done = false
    let lastDetail = ''
    let lastSweep = false
    const finish = (result: SakuraLoginResult): void => {
      if (done) return
      done = true
      resolve(result)
    }

    /*
     * 每次页面加载完看一眼：还没登录时页面是登录表单，登录后才会出现账号内容。
     * 先问接口（快且确定），再翻页面文本（兜底）。
     */
    const inspect = async (): Promise<void> => {
      if (done || win.isDestroyed()) return
      note('inspect url=' + win.webContents.getURL())
      const fromApi = await tokenFromApi(partition)
      if (fromApi.token) {
        finish({ ok: true, token: fromApi.token, message: '' })
        win.close()
        return
      }
      /* 把接口那几句诊断留给最后一次结算用，窗口关时一起报出来。 */
      lastDetail = fromApi.detail
      let fromPage = await tokenFromPage(win)
      if (!fromPage && !lastSweep) {
        lastSweep = true
        fromPage = await sweepPages(win, note)
      }
      if (fromPage) note('页面里找到候选 ' + shape(fromPage))
      try {
        const text = String(await win.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true))
        note('页面文本 ' + text.replace(/\s+/g, ' ').slice(0, 240))
      } catch {
        /* 页面还没就绪 */
      }
      if (fromPage) {
        finish({ ok: true, token: fromPage, message: '' })
        win.close()
      }
    }

    win.webContents.on('did-finish-load', () => {
      void inspect()
    })
    /* 网页是单页应用，跳转不一定触发加载完成，所以定期再试一次。 */
    const timer = setInterval(() => void inspect(), 2500)

    win.on('closed', () => {
      clearInterval(timer)
      loginWindow = null
      note('关闭时没拿到：' + (lastDetail || '接口也无诊断'))
      finish({
        ok: false,
        token: '',
        message: '登录窗口关掉了，没拿到密钥' + (lastDetail ? '（接口：' + lastDetail + '）' : '')
      })
    })

    void win.loadURL(HOME_URL)
    /* 设置页在登录后才有内容；先停在首页，用户登录完自己点进去也行。 */
    void SETTINGS_URL
  })
}
