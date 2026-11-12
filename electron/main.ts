import { app, BrowserWindow, globalShortcut, screen, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { loadSettings } from './settings'
import { syncLoginItem } from './login-item'
import { releaseSleepBlocker } from './power'
import { handleMediaProtocol, registerMediaScheme } from './protocols/media-protocol'
import { handleRemoteProtocol, registerRemoteScheme } from './protocols/remote-protocol'
import { handleWallpaperProtocol, registerWallpaperScheme } from './wallpaper'
import { registerNeteaseIpc, warmUpNetease } from './netease/ipc'
import { registerQqIpc } from './qq/ipc'
import { registerKugouIpc } from './kugou/ipc'
import { registerQishuiIpc } from './qishui/ipc'
import { closeStartupLog, openStartupLog, startupLogPath, write } from './startup-log'
import { APP_ORIGIN, handleAppProtocol, registerAppScheme } from './protocols/app-protocol'
import {
  configureProgressTransport,
  mainWindowVisibility,
  type WindowVisibilityState
} from './pure/scan-progress'
import { autoCheck, hasReadyUpdate, installPendingUpdate, onUpdateStatus, type UpdateResult } from './updates'
import {
  createTray,
  destroyTray,
  hasTray,
  installThumbar,
  refreshTrayImage,
  refreshTrayMenu,
  type MediaCommand,
  type TrayHandlers
} from './tray'
import { applyIconFromArgv, initCustomIcon, onIconChanged, windowIconPath } from './app-icon'
import {
  destroyOverlay,
  initOverlay,
  isLocked as isOverlayLocked,
  setLocked as setOverlayLocked,
  status as overlayStatus,
  toggleOverlay
} from './lyrics-overlay'
import { registerAppIpc } from './ipc/app'
import { registerLibraryIpc } from './ipc/library'
import { registerWallpaperIpc } from './ipc/wallpaper'
import { registerOverlayIpc } from './ipc/overlay'
import { registerDownloadsIpc } from './ipc/downloads'
import { registerUpdatesIpc } from './ipc/updates'
import { registerLyricsIpc } from './ipc/lyrics'
import { registerPlayerIpc } from './ipc/player'
import { registerSettingsIpc } from './ipc/settings'
import { registerMaintenanceIpc } from './ipc/maintenance'
import { sweepPendingJunk } from './maintenance'
import type { IpcHost, ScanControl } from './ipc/host'

const isDev = process.argv.includes('--dev')
const DEV_URL = 'http://127.0.0.1:5173'
const captureArg = process.argv.find((arg) => arg.startsWith('--capture='))

// Makes Chromium route the Media Session API into the Windows SMTC
// (System Media Transport Controls), which is what gives us the volume-flyout
// overlay, hardware media keys and the taskbar preview controls.
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService')

app.setAppUserModelId('com.aurora.player')

// Must run before the app is ready, or Chromium will not treat these schemes as
// standard/secure and range requests and module loading will not be permitted.
registerMediaScheme()
registerAppScheme()
// `aurora-remote:` is the proxy for online media (Netease audio and covers).
// Registering it here keeps it in the same privileged position as the local
// media scheme: range requests and CORS both depend on it.
registerRemoteScheme()
// `aurora-wallpaper:` serves the active Wallpaper Engine project so the app can
// use it as a backdrop. Same privileged position: a video wallpaper loops with
// range requests just like local audio does.
registerWallpaperScheme()

interface WinState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

let mainWindow: BrowserWindow | null = null

/** Set while a scan is running so it can be abandoned from the UI. */
let activeScan: ScanControl | null = null

/** Set on the way out, so the close handler stops hiding the window. */
let isQuitting = false

/** Mirrors the renderer's playback state so the thumbnail button shows the right glyph. */
let lastPlaying = false

function sendMediaCommand(command: MediaCommand): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('media:command', command)
  }
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function toggleWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  // Minimised counts as hidden: clicking the tray should bring it back, not
  // hide it further.
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) mainWindow.hide()
  else showWindow()
  refreshTrayMenu(trayHandlers())
}

/**
 * Tell the renderer when the player window stops (or resumes) being on screen.
 *
 * The renderer needs this because `document.hidden` can be stale in Electron -
 * a window hidden to the tray may still report itself visible, and with
 * `backgroundThrottling: false` the page keeps running at full rate either way.
 * Only changes are announced; the renderer reads the initial state once at
 * startup through `app:visibility`.
 */
let lastVisibility: WindowVisibilityState | null = null

function notifyVisibility(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const next = mainWindowVisibility(mainWindow)
  if (
    lastVisibility &&
    lastVisibility.visible === next.visible &&
    lastVisibility.minimized === next.minimized &&
    lastVisibility.hidden === next.hidden
  ) {
    return
  }
  lastVisibility = next
  mainWindow.webContents.send('app:visibility', next)
}

const trayHandlers = (): TrayHandlers => ({
  toggleWindow,
  /*
   * 「只显示」这一档防的是误触：想点开看一眼，结果一点窗口就没了。
   * 已经是前台时 showWindow 不会把它藏起来，所以这一档是安全的。
   */
  trayClick: () => {
    if (loadSettings().trayClick === 'show') showWindow()
    else toggleWindow()
  },
  isWindowVisible: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
  command: sendMediaCommand,
  quit: () => {
    isQuitting = true
    app.quit()
  },
  extraItems: () => [
    { type: 'separator' },
    {
      label: overlayStatus().open ? '隐藏桌面歌词' : '显示桌面歌词',
      accelerator: 'Control+Alt+L',
      click: () => toggleOverlay()
    },
    {
      label: isOverlayLocked() ? '解锁桌面歌词（可拖动）' : '锁定桌面歌词（鼠标穿透）',
      accelerator: 'Control+Alt+K',
      enabled: overlayStatus().open,
      click: () => setOverlayLocked(!isOverlayLocked())
    }
  ]
})

/**
 * The overlay is useless if it can only be reached by clicking a window that is
 * already behind something else, so both actions get a global shortcut.
 */
function registerGlobalShortcuts(): void {
  const bindings: [string, () => void][] = [
    ['Control+Alt+L', () => toggleOverlay()],
    ['Control+Alt+K', () => setOverlayLocked(!isOverlayLocked())]
  ]

  for (const [accelerator, handler] of bindings) {
    try {
      const registered = globalShortcut.register(accelerator, handler)
      if (!registered) console.error('[aurora] shortcut already taken:', accelerator)
    } catch (error) {
      console.error('[aurora] could not register shortcut', accelerator, error)
    }
  }
}

const stateFile = (): string => path.join(app.getPath('userData'), 'window-state.json')

/**
 * Window geometry, read once off the startup path.
 *
 * `createWindow` needs these synchronously, so the read cannot be moved into
 * it - but it also must not block the app from reaching its first frame for the
 * sake of a few hundred bytes. So it is read once, asynchronously, while the
 * window is being built; if it is not ready yet the defaults are used and the
 * saved size simply does not apply on that one launch.
 */
let winStateCache: WinState | null = null

async function preloadWinState(): Promise<void> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(stateFile(), 'utf8')) as WinState
    if (typeof raw.width === 'number' && typeof raw.height === 'number') winStateCache = raw
  } catch {
    /* first run, or a corrupt file we simply ignore */
  }
}

function loadWinState(): WinState {
  return winStateCache ?? { width: 1360, height: 860 }
}

function saveWinState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // 截图用的临时尺寸不是用户的选择，别写回 window-state.json。
  if (process.argv.some((arg) => arg.startsWith('--capture='))) return
  const bounds = mainWindow.getNormalBounds()
  const next: WinState = {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    maximized: mainWindow.isMaximized()
  }
  winStateCache = next
  // Asynchronous on purpose: this runs on resize/move (already debounced) and on
  // close, and a synchronous write of a few hundred bytes still parks the main
  // process - which is the one place the docs tell you never to block.
  void (async () => {
    try {
      await fs.promises.mkdir(path.dirname(stateFile()), { recursive: true })
      await fs.promises.writeFile(stateFile(), JSON.stringify(next))
    } catch {
      /* losing window geometry is never worth crashing over */
    }
  })()
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: NodeJS.Timeout | undefined
  return ((...args: never[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T
}

/**
 * Warm the online source up, but only once nothing else needs the main process.
 *
 * `setTimeout` rather than `requestIdleCallback` because the cost being deferred
 * is module loading and disk I/O, not a layout-sensitive task; the delay is what
 * keeps it off the first-frame path, and the guard keeps it to one scheduling
 * even if `whenReady` runs again for a window that was closed and reopened.
 */
let neteaseWarmUpScheduled = false

function scheduleNeteaseWarmUp(): void {
  if (neteaseWarmUpScheduled) return
  neteaseWarmUpScheduled = true
  setTimeout(() => {
    void warmUpNetease()
  }, 3000)
}

function createWindow(): void {
  const state = loadWinState()

  /*
   * 截图验收要能停在任意窗口宽度。
   *
   * 正常启动的最小宽度是 940，而底栏在 900 以下会换排法——那一档如果被窗口
   * 自身的最小尺寸挡住，就永远只能靠读 CSS 相信它是对的。所以只在这一条
   * 截图通道上放行更小的尺寸，正常使用不受影响。
   */
  const sizeArg = process.argv.find((arg) => arg.startsWith('--size='))
  const sized = sizeArg?.slice('--size='.length).match(/^(\d+)x(\d+)$/) ?? null

  /*
   * 上次是以最大化退出的，就直接按「最大化后的可用区域」建窗口，再补一次
   * maximize()。
   *
   * 先按普通尺寸造出来、随后 maximize()，渲染进程会在中间拿到一次小尺寸的
   * resize：那一帧里左栏还在按小窗口算、正文按小窗口排，下一帧才铺开——
   * 用户看到的就是「打开时容器大小错位，闪一下又好了」。尺寸一上来就对，
   * 这个中间帧根本不会产生。
   */
  const maximized = state.maximized === true
  const area = maximized
    ? screen.getDisplayMatching({
        x: state.x ?? 0,
        y: state.y ?? 0,
        width: state.width,
        height: state.height
      }).workArea
    : null

  mainWindow = new BrowserWindow({
    width: sized ? Number(sized[1]) : area ? area.width : state.width,
    height: sized ? Number(sized[2]) : area ? area.height : state.height,
    x: area ? area.x : state.x,
    y: area ? area.y : state.y,
    minWidth: sized ? 520 : 940,
    minHeight: sized ? 420 : 620,
    /*
     * 先不显示，等开屏那一页画出来（见下面的 showSplash）。
     *
     * 应用页太重：Vite 的 bundle、首页几十张图、动态壁纸，实测第一个像素要 1.5
     * 秒。窗口若在这时就显示，用户先看到的是浏览器底色，然后开屏才姗姗来迟——
     * 也就是「开场动画后于主页出现」。改成先加载 public/splash.html（内联 CSS，
     * 不到十个数得完的 DOM），它一上屏就显示窗口，应用页随后在它背后加载。
     */
    show: false,
    backgroundColor: '#0d1013',
    // 用户设过自定义图标时用它，否则用 assets 里那张；任务栏与 Alt+Tab 都认这个。
    icon: windowIconPath(),
    // Custom chrome: we draw the title bar ourselves, while Windows keeps the
    // real caption buttons overlaid so snap layouts and aero snap still work.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#c8ccd6',
      height: 44
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // A desktop player is not a web page: it may resume playback on launch
      // without waiting for a click it will never get.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
      webSecurity: true
    }
  })

  if (state.maximized) mainWindow.maximize()

  /*
   * 拖窗口边缘时，界面里的毛玻璃（backdrop-filter）要按新尺寸重新采样背景，
   * 那几帧会慢到把旧布局留在屏幕上——看着就是「容器大小错位，闪一下才好」。
   * 拖动期间先关掉它，松手 120ms 后再开，眼睛只看见窗口变宽，看不见重排。
   */
  let resizeSettle: NodeJS.Timeout | null = null
  mainWindow.on('resize', () => {
    const window = mainWindow
    if (!window || window.isDestroyed()) return
    if (!resizeSettle) window.webContents.send('win:resizing', true)
    else clearTimeout(resizeSettle)
    resizeSettle = setTimeout(() => {
      resizeSettle = null
      if (!window.isDestroyed()) window.webContents.send('win:resizing', false)
    }, 120)
  })
  mainWindow.on('closed', () => {
    if (resizeSettle) clearTimeout(resizeSettle)
    resizeSettle = null
  })

  const bootAt = Date.now()
  /*
   * 开屏页至少演多久再让位给应用页。
   *
   * 这是一个实测值，不是估的：描边动画 620ms 加右腿 90ms 错位，本身要 710ms；
   * 而窗口显示之前那几帧动画时钟还没走，所以从 show 到画完要按 800ms 算。再留
   * 300ms 让人看清这是个完整的标志，才切到应用页。短于这个数，用户看到的是
   * 「线条画到一半就跳主页了」。
   */
  const SPLASH_MIN_MS = 1100
  let splashShownAt = 0

  /*
   * 显示窗口。开屏页的 DOM 一就绪就能看，不必等 ready-to-show——那张页面里没有
   * 脚本要执行，dom-ready 与首帧之间只差一次样式计算。
   */
  const showSplash = (): void => {
    const window = mainWindow
    if (!window || window.isDestroyed() || window.isVisible()) return
    splashShownAt = Date.now()
    window.show()
    write(`splash shown +${Date.now() - bootAt}ms`)
  }

  mainWindow.once('ready-to-show', () => {
    const window = mainWindow
    if (!window) return
    // 「打开多久才看见东西」就是这一段：ready-to-show 之后才 show。
    write(`ready-to-show +${Date.now() - bootAt}ms`)
    showSplash()
    installThumbar(window, lastPlaying, sendMediaCommand)
  })

  mainWindow.on('close', (event) => {
    saveWinState()
    /*
     * Closing a music player should not stop the music. Hide instead - but only
     * when a tray icon actually exists, because hiding without one would leave
     * a running process with no way back to its window.
     */
    if (isQuitting || !hasTray()) return
    /*
     * 设置里选了「关掉窗口就退出」的，关闭按钮必须真的关掉：托盘还在，
     * 但它不再是这个按钮的含义。不 preventDefault 就是让窗口真的销毁，
     * window-all-closed 随后 quit。
     */
    if (!loadSettings().closeToTray) return
    event.preventDefault()
    mainWindow?.hide()
    refreshTrayMenu(trayHandlers())
  })

  mainWindow.on('show', () => {
    refreshTrayMenu(trayHandlers())
    notifyVisibility()
  })
  mainWindow.on('hide', () => {
    refreshTrayMenu(trayHandlers())
    notifyVisibility()
    /*
     * 收起窗口说明用户这会儿不看它，正好换版本：静默装、装完自动回来，
     * 下次点托盘图标就是新版。这一条是「不用点安装包」的主力——默认
     * 关闭按钮就是收进托盘，用户其实很少真正退出应用。
     */
    if (hasReadyUpdate()) void installPendingUpdate()
  })
  // Minimise and restore are visibility changes too, and they are the states
  // `document.hidden` reports least reliably inside Electron.
  mainWindow.on('minimize', notifyVisibility)
  mainWindow.on('restore', notifyVisibility)

  mainWindow.on('resize', debounce(saveWinState, 400))
  mainWindow.on('move', debounce(saveWinState, 400))

  // External links leave the app instead of hijacking the player window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * Surface a failed renderer load instead of showing an empty window.
   *
   * A packaged build shipped with a bug in the app protocol handler and opened as a
   * black window with the word "not found" - no error, no dialog, nothing to act on.
   * The renderer never runs in that state, so it cannot report anything itself; the
   * only place that knows is here. The message replaces the page, which turns
   * "it is blank" into a sentence naming the step that failed.
   */
  const reportLoadFailure = (reason: string): void => {
    const log = startupLogPath()
    const text =
      `Aurora 无法加载界面（${reason}）。这是程序错误，请把下面这句话连同日志文件一起反馈。\n\n` +
      `地址：${APP_ORIGIN}/index.html\n` +
      (log ? `日志：${log}\n` : '')
    void mainWindow?.webContents
      .executeJavaScript(
        `document.body.innerHTML = '<pre style="font:13px/1.6 ui-monospace,Consolas,monospace;color:#e6e6e6;background:#141414;padding:24px;white-space:pre-wrap;margin:0">' +
          ${JSON.stringify(text)}.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) +
          '</pre>'`
      )
      .catch(() => undefined)
  }
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('[aurora] renderer load failed', errorCode, errorDescription, validatedURL)
    write(`did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`)
    reportLoadFailure(`${errorDescription || errorCode} ← ${validatedURL}`)
  })

  /*
   * Everything the renderer says before it dies, and the outcome of each load step.
   * The renderer is the only place that knows whether the bundle executed, and when
   * it does not run at all this is the only remaining witness.
   */
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    write(`renderer[${level}] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('did-finish-load', () => write('did-finish-load'))
  mainWindow.webContents.on('did-stop-loading', () => write('did-stop-loading'))
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    write(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`)
  })

  /*
   * 打包版先上开屏页，隔着一段时间再导航到应用页。
   *
   * 开发版与截图验收都直接进应用页：前者的模块由 Vite 现编，等它反而更慢；后者
   * 要截的正是应用本身，多一张开屏只会挡路。
   */
  const useSplash = !isDev && !captureArg
  const appUrl = `${APP_ORIGIN}/index.html`

  if (useSplash) {
    const splashUrl = `${APP_ORIGIN}/splash.html`
    write(`loading ${splashUrl}`)
    void mainWindow.loadURL(splashUrl)
    mainWindow.webContents.once('did-finish-load', () => {
      const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - (splashShownAt || Date.now())))
      write(`splash ready +${Date.now() - bootAt}ms, navigating in ${wait}ms`)
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        write(`loading ${appUrl}`)
        void mainWindow.loadURL(appUrl)
      }, wait)
    })
  } else if (isDev) {
    write(`loading ${DEV_URL}`)
    void mainWindow.loadURL(DEV_URL)
    if (!captureArg) mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Served over a private scheme rather than file://. An opaque file:// origin
    // blocks the module script and defeats the app's own `script-src 'self'`;
    // see electron/protocols/app-protocol.ts.
    write(`loading ${appUrl}`)
    void mainWindow.loadURL(appUrl)
  }

  // 开屏页的 DOM 一到就显示窗口；应用页那一次 dom-ready 会被这里跳过（窗口已可见）。
  mainWindow.webContents.once('dom-ready', showSplash)

  if (captureArg) {
    const out = captureArg.slice('--capture='.length)
    // 截图验收要能停在任意一页；页面地址就是外壳路由，先改地址再截。
    const hashArg = process.argv.find((arg) => arg.startsWith('--hash='))
    // 长页面验收要能停在半屏；内容滚在 .main__body 里，不是 window。
    const scrollArg = process.argv.find((arg) => arg.startsWith('--scroll='))
    // 截图验收要能停在任意交互态；面板/菜单都是 onClick 打开的，先点一下再截。
    const clickArg = process.argv.find((arg) => arg.startsWith('--click='))
    // 点下去之后有些动作还要去网上要数据（漫游就是），800ms 只够截到「正在要」。
    // 验收这类状态用 --settle=<ms> 把等待拉长，默认仍是原来的 800。
    const settleArg = process.argv.find((arg) => arg.startsWith('--settle='))
    const settleMs = Math.max(0, Number(settleArg?.slice('--settle='.length)) || 800)
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          try {
            if (hashArg) {
              const hash = hashArg.slice('--hash='.length)
              await mainWindow?.webContents.executeJavaScript(
                `window.location.hash = ${JSON.stringify(hash)}`
              )
              await new Promise((resolve) => setTimeout(resolve, 1200))
            }
            if (clickArg) {
              const selector = clickArg.slice('--click='.length)
              // 点不到时最想知道的是「选择器错在哪」：命中几个、命中的是谁、点完它有没有变。
              // 静默失败一次就要重跑一轮截图，所以这里把回执写进日志。
              const receipt = await mainWindow?.webContents.executeJavaScript(
                `(() => {
                  const found = document.querySelectorAll(${JSON.stringify(selector)})
                  const el = found[0]
                  if (!el) return { hits: 0, cls: null, clicked: false, after: null }
                  el.click()
                  return { hits: found.length, cls: String(el.className), clicked: true }
                })()`
              )
              write(`click ${selector} -> ${JSON.stringify(receipt)}`)
              await new Promise((resolve) => setTimeout(resolve, settleMs))
            }
            if (scrollArg) {
              const y = Number(scrollArg.slice('--scroll='.length)) || 0
              await mainWindow?.webContents.executeJavaScript(
                `(() => { const el = document.querySelector('.main__body'); if (el) el.scrollTop = ${y}; return Boolean(el) })()`
              )
              await new Promise((resolve) => setTimeout(resolve, 700))
            }
            if (process.argv.includes('--probe')) {
              const facts = await mainWindow?.webContents.executeJavaScript(
                `(async () => {
                  // 跟随高光的坐标只在指针动过之后才有；这里合成一次，好让回读有值。
                  const glowHost = document.querySelector('.player')
                  if (glowHost) {
                    const box = glowHost.getBoundingClientRect()
                    const at = {
                      clientX: box.left + box.width * 0.32,
                      clientY: box.top + box.height * 0.5,
                      pointerType: 'mouse',
                      bubbles: true
                    }
                    const target = glowHost.firstElementChild || glowHost
                    target.dispatchEvent(new PointerEvent('pointermove', at))
                    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
                  }
                  const b = document.querySelector('.main__body')
                  const rh = document.querySelector('.rh')
                  const nav = performance.getEntriesByType('navigation')[0] || {}
                  // 首屏到底花在哪：导航各阶段 + 两张 paint 标记。截图等 2.6 秒，
                  // 这时 first-contentful-paint 一定已经落了，读出来的就是真值。
                  const paint = {}
                  for (const entry of performance.getEntriesByType('paint')) paint[entry.name] = Math.round(entry.startTime)
                  return {
                    scrollTop: b && b.scrollTop,
                    bodyH: b && b.clientHeight,
                    rhFirst: rh && rh.firstElementChild && rh.firstElementChild.className,
                    rhTop: rh && Math.round(rh.getBoundingClientRect().top),
                    bodyTop: b && Math.round(b.getBoundingClientRect().top),
                    longtasks: window.__longtasks || [],
                    // 液态玻璃：每块玻璃挂上了哪条折射滤镜、算出来的 --refract 长什么样。
                    // 折射看不见时先看这里——多半是选择器没匹上，或者贴图建了却没挂到元素。
                    glass: Array.from(
                      document.querySelectorAll(
                        '.player, .panel, .menu, .lk-menu, .tracks__tool, .rh-sc, .rh-daily'
                      )
                    ).map((el) => {
                      const box = el.getBoundingClientRect()
                      return {
                        cls: String(el.className).slice(0, 32),
                        w: Math.round(box.width),
                        h: Math.round(box.height),
                        refract: el.style.getPropertyValue('--refract'),
                        glue: (el.style.getPropertyValue('--mx') || '-') + ' ' + (el.style.getPropertyValue('--my') || '-'),
                        backdrop: getComputedStyle(el).backdropFilter
                      }
                    }),
                    refractFilters: document.querySelectorAll('svg filter[id^="refract-"]').length,
                    // 底栏按钮的类名就是它的状态：点在哪个键、开了哪几个，一眼看得出。
                    playerButtons: Array.from(document.querySelectorAll('.player button')).map(
                      (el) => (el.getAttribute('data-tip') || el.getAttribute('title') || '?') + '|' + String(el.className)
                    ),
                    // 左栏也一样：漫游不是一页，它的状态只写在按钮的类名和那颗点上。
                    railItems: Array.from(document.querySelectorAll('.rail-item')).map(
                      (el) =>
                        (el.getAttribute('aria-label') || el.textContent || '?').trim().slice(0, 12) +
                        '|' +
                        String(el.className) +
                        (el.querySelector('.rail-item__dot') ? '|dot' : '') +
                        (el.querySelector('.rail-item__spin') ? '|spin' : '')
                    ),
                    timing: {
                      responseEnd: Math.round(nav.responseEnd || 0),
                      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
                      load: Math.round(nav.loadEventEnd || 0),
                      paint
                    }
                  }
                })()`
              )
              fs.writeFileSync(out + '.json', JSON.stringify(facts, null, 2))
            }
            const image = await mainWindow?.webContents.capturePage()
            if (image) fs.writeFileSync(out, image.toPNG())
          } catch (error) {
            console.error('[aurora] capture failed', error)
          }
          app.quit()
        })()
      }, 2600)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * The one owner of the mutable facts the IPC modules need.
 *
 * Each field reads main.ts's own variable at call time, so a handler sees a
 * recreated window, a scan that has finished, or a playback-state change
 * immediately. Nothing here is a second copy of the state.
 */
const ipcHost: IpcHost = {
  window: () => mainWindow,
  scan: () => activeScan,
  setScan: (scan) => {
    activeScan = scan
  },
  playing: () => lastPlaying,
  setPlaying: (playing) => {
    lastPlaying = playing
  },
  sendCommand: sendMediaCommand
}

/**
 * Handler registration, split by business domain.
 *
 * Called once from `whenReady`, in the same position the inline handlers used to
 * occupy: before the window exists, so no renderer invoke can race ahead of its
 * handler. Domains are called in the order their first handler appeared in the
 * old single function, and every domain keeps its channels in their original
 * order. The order *between* domains is not observable: each channel is
 * registered exactly once, and no handler body runs until the renderer invokes
 * it.
 */
function registerIpc(): void {
  registerAppIpc(ipcHost)
  registerLibraryIpc(ipcHost)
  registerWallpaperIpc()
  // 桌面歌词的工具条按钮和托盘走同一条播放命令通道。
  registerOverlayIpc(sendMediaCommand)
  registerUpdatesIpc()
  registerDownloadsIpc()
  registerLyricsIpc()
  registerPlayerIpc(ipcHost)
  registerSettingsIpc(ipcHost, ipcHost.playing)
  registerMaintenanceIpc()
}

/*
 * 探针与截图要能并开一份，不能去抢用户正在用的那一份。
 *
 * 单实例锁是按 userData 目录加锁的，所以把这份实例的 userData 挪到临时目录，
 * 它就成了另一个「应用」，可以和用户窗口同时活着。只做验证时用，正常启动
 * 不设这个变量，行为与从前一致。
 */
const scratchProfile = process.env.AURORA_PROFILE
if (scratchProfile) {
  app.setPath('userData', path.join(app.getPath('temp'), 'aurora-' + scratchProfile))
}

// Single instance: a second launch focuses the running player instead of
// starting a rival media session.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    /*
     * Opened first, so everything after it can be recorded.
     *
     * A packaged build once opened as a blank window with no way to find out why -
     * the renderer never runs in that state, so it cannot report anything. This log
     * is what makes the next such failure answerable: it holds the requests the
     * renderer made and what the main process answered.
     */
    openStartupLog(app.getPath('userData'), app.getVersion(), app.isPackaged)
    write(`userData=${app.getPath('userData')}`)
    write(`appPath=${app.getAppPath()}`)
    write(`argv=${process.argv.slice(1).join(' ')}`)
    //
    // 上次清理时被占用、没删掉的垃圾在这里补删。必须赶在窗口建起来之前：
    // 一旦渲染进程启动，Chromium 又会把那些缓存文件重新打开并锁住。
    void sweepPendingJunk()
    // 窗口尺寸必须在建窗之前拿到：读盘一旦晚于 createWindow，首帧就会退回默认
    // 1360x860，等保存的尺寸到位再跳一次。这一行是同步等待，代价是几毫秒读盘。
    await preloadWinState()
    // Scan progress is coalesced in its own module so the throttle is testable;
    // the actual delivery stays here, where the windows are known.
    configureProgressTransport({
      send: (progress) => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send('library:progress', progress)
        }
      }
    })
    handleMediaProtocol()
    handleAppProtocol()
    handleRemoteProtocol()
    handleWallpaperProtocol()
    initOverlay((status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('overlay:status', status)
      }
    })
    // Update transitions (download progress, readiness) are pushed to whichever
    // window is open; the settings page subscribes to them.
    onUpdateStatus((result) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updates:status', result)
      }
    })
    registerIpc()
    // 登录项按设置文件重写一次：重装或换路径后注册表里的那条可能已经不在了。
    syncLoginItem()
    createWindow()
    createTray(trayHandlers())
    // 图标换了以后托盘得跟着换：窗口图标由 app-icon 自己铺，这里只管托盘。
    onIconChanged(() => refreshTrayImage())
    // 重装或换了路径之后快捷方式会丢图标，启动时补一次。
    initCustomIcon()
    // 自动化验收用：--set-icon=<图片> 直接把图标设成这张。
    applyIconFromArgv()
    registerGlobalShortcuts()

    /*
     * The Netease client needs two pieces of state in the OS temp directory
     * before its own module can even be required (see electron/netease/client.ts).
     * That bootstrap is slow and memory-hungry: measured at ~1.5 s and ~29 MB
     * resident, because the upstream package eagerly requires all 449 of its
     * endpoint modules (and jsdom with them) whether or not Aurora uses them.
     *
     * It is therefore deferred until the machine is idle *after* the window has
     * been shown, rather than fired the moment the app is ready. A user who only
     * plays local files never pays it at all; a user who opens the online tab
     * gets a bootstrap that is already warm.
     *
     * IPC handlers are registered first regardless: they are what makes the
     * bootstrap reachable on demand, and they cost ~1.5 ms on their own.
     */
    registerNeteaseIpc()
    scheduleNeteaseWarmUp()

    /*
     * QQ is registered the same way and for the same reason: the handlers cost
     * nothing until something invokes them.
     *
     * There is deliberately no warm-up call beside it. Netease needs one because
     * its upstream package performs a boot handshake that would otherwise land on
     * the first search; QQ's client is a plain HTTP wrapper with nothing to warm.
     */
    registerQqIpc()

    /*
     * 酷狗同 QQ：只接线，不预热。它背后是一个本地 vendor 服务，第一次真的要用
     * 时才拉起来（`ensureServer()` 幂等），没人打开酷狗页面就一分钱不花。
     */
    registerKugouIpc()

    /*
     * 汽水更简单：没有进程要拉起来，SDK 在主进程里 require 就能用，设备 id 与
     * 会话按档案存在 userData。同样只接线不预热。
     */
    registerQishuiIpc()

    const announceUpdate = (result: UpdateResult): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updates:available', result)
      }
    }
    void autoCheck(announceUpdate)
    /*
     * 只在启动时查一次，等于「一直挂着不重启就永远查不到新版」。半小时问一次
     * `autoCheck`，它自己按设置里的间隔（手动 / 每天 / 每周）决定要不要真发请求，
     * 所以这里不会把 GitHub 当靶子。
     */
    const updateTimer = setInterval(() => {
      void autoCheck(announceUpdate)
    }, 30 * 60 * 1000)
    app.on('before-quit', () => clearInterval(updateTimer))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    globalShortcut.unregisterAll()
    releaseSleepBlocker()
    destroyOverlay()
    destroyTray()
    // Flush the startup log, so a crash during shutdown still leaves what happened.
    write('before-quit')
    closeStartupLog()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
