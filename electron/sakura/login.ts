import { BrowserWindow, clipboard, session } from 'electron'
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
        if (typeof value === 'string' && value.trim()) return { token: value.trim(), detail: '' }
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


/**
 * 在页面里借登录态要一次用户信息。
 *
 * 官方 openapi 里 /user/info 的 token 字段就是访问密钥（示例值 wdnmdtoken666666，
 * 所以它不是 32 位十六进制）。面板前端走的是同源相对路径，cookie 由 nginx 转给
 * 后端——所以必须从这个页面的上下文里发请求，主进程直接 session.fetch 到 api 域名
 * 会被判成未登录（之前就是这么 401 的）。
 */
async function tokenFromPanel(win: BrowserWindow): Promise<{ token: string; detail: string }> {
  try {
    const raw = String(
      await win.webContents.executeJavaScript(
        "fetch('/v4/user/info', { headers: { Accept: 'application/json' } }).then(r => r.text()).catch(e => 'ERR ' + e.message)",
        true
      )
    )
    if (raw.startsWith('ERR')) return { token: '', detail: 'fetch 失败 ' + raw.slice(4, 80) }
    let body: { code?: number; msg?: string; data?: Record<string, unknown> } | null = null
    try {
      body = JSON.parse(raw) as { code?: number; msg?: string; data?: Record<string, unknown> }
    } catch {
      return { token: '', detail: '非 JSON：' + raw.slice(0, 60) }
    }
    if (!body || body.code !== 0 || !body.data) {
      return { token: '', detail: 'code ' + body?.code + ' ' + (body?.msg ?? '') }
    }
    const value = body.data.token
    if (typeof value === 'string' && value.trim()) return { token: value.trim(), detail: '' }
    return { token: '', detail: '字段里没有 token：' + Object.keys(body.data).slice(0, 6).join(',') }
  } catch (error) {
    return { token: '', detail: '页面里执行失败 ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/**
 * 点「复制访问密钥」，再从剪贴板读回来。
 *
 * 页面文本里明明有「复制访问密钥」这一颗键，说明密钥是页面自己管着的——正则去
 * 正文里找一个 16~64 位的串只会抓到 JS 标识符（上一次就抓回了
 * UseBASE64Intrinsics）。点它、读剪贴板，才是页面本来给用户的路径。
 */
async function tokenFromClipboard(win: BrowserWindow): Promise<{ token: string; detail: string }> {
  try {
    const clicked = String(
      await win.webContents.executeJavaScript(
        `(() => {
          const all = [...document.querySelectorAll('button, a, span, div, i, svg')]
          /* 文本里带「复制访问密钥」就算：图标与文字常被拆成两层，全等匹配会漏。 */
          const hit = all
            .filter((el) => (el.textContent || '').includes('复制访问密钥'))
            .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0]
          if (!hit) return 'no-button'
          hit.click()
          return 'clicked'
        })()`,
        true
      )
    )
    if (clicked !== 'clicked') return { token: '', detail: '页面上找不到「复制访问密钥」' }
    /*
     * 剪贴板要等页面把值写进去，快慢不定，所以连着试几轮——一轮读不到就放弃等于
     * 把「全自动」做成了「看运气」。
     */
    let raw = ''
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      raw = String(clipboard.readText()).trim()
      if (raw) break
    }
    /* 剪贴板里可能是用户别处复制的东西：只认长度像密钥、且不含空白的。 */
    if (!raw || raw.length < 8 || raw.length > 128 || /\s/.test(raw)) {
      return { token: '', detail: '剪贴板里不像密钥（' + raw.length + ' 字符）' }
    }
    return { token: raw, detail: '' }
  } catch (error) {
    return { token: '', detail: '点击失败 ' + (error instanceof Error ? error.message : String(error)) }
  }
}

/** 从页面里找：设置页把密钥渲染在页面上，按形状捞一次。 */

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
      const fromClip = await tokenFromClipboard(win)
      note('剪贴板：' + (fromClip.token ? '拿到 ' + shape(fromClip.token) : fromClip.detail))
      if (fromClip.token) {
        finish({ ok: true, token: fromClip.token, message: '' })
        win.close()
        return
      }
      const fromPanel = await tokenFromPanel(win)
      note('同源接口：' + (fromPanel.token ? '拿到密钥 ' + shape(fromPanel.token) : fromPanel.detail))
      if (fromPanel.token) {
        finish({ ok: true, token: fromPanel.token, message: '' })
        win.close()
        return
      }
      const fromApi = await tokenFromApi(partition)
      if (fromApi.token) {
        finish({ ok: true, token: fromApi.token, message: '' })
        win.close()
        return
      }
      /* 把接口那几句诊断留给最后一次结算用，窗口关时一起报出来。 */
      lastDetail = fromApi.detail
      try {
        const text = String(await win.webContents.executeJavaScript("document.body ? document.body.innerText : ''", true))
        note('页面文本 ' + text.replace(/\s+/g, ' ').slice(0, 240))
      } catch {
        /* 页面还没就绪 */
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
