import { app, BrowserWindow, globalShortcut, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { loadSettings } from './settings'
import { handleMediaProtocol, registerMediaScheme } from './protocols/media-protocol'
import { handleRemoteProtocol, registerRemoteScheme } from './protocols/remote-protocol'
import { handleWallpaperProtocol, registerWallpaperScheme } from './wallpaper'
import { registerNeteaseIpc, warmUpNetease } from './netease/ipc'
import { registerQqIpc } from './qq/ipc'
import { closeStartupLog, openStartupLog, startupLogPath, write } from './startup-log'
import { APP_ORIGIN, handleAppProtocol, registerAppScheme } from './protocols/app-protocol'
import {
  configureProgressTransport,
  mainWindowVisibility,
  type WindowVisibilityState
} from './pure/scan-progress'
import { autoCheck, onUpdateStatus, type UpdateResult } from './updates'
import {
  createTray,
  destroyTray,
  hasTray,
  installThumbar,
  refreshTrayMenu,
  type MediaCommand,
  type TrayHandlers
} from './tray'
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

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: '#0d1013',
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

  mainWindow.once('ready-to-show', () => {
    const window = mainWindow
    if (!window) return
    window.show()
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

  write(`loading ${isDev ? DEV_URL : `${APP_ORIGIN}/index.html`}`)

  if (isDev) {
    void mainWindow.loadURL(DEV_URL)
    if (!captureArg) mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Served over a private scheme rather than file://. An opaque file:// origin
    // blocks the module script and defeats the app's own `script-src 'self'`;
    // see electron/protocols/app-protocol.ts.
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
  }

  if (captureArg) {
    const out = captureArg.slice('--capture='.length)
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void (async () => {
          try {
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
  registerOverlayIpc()
  registerUpdatesIpc()
  registerLyricsIpc()
  registerPlayerIpc(ipcHost)
  registerSettingsIpc(ipcHost)
  registerMaintenanceIpc()
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

  void app.whenReady().then(() => {
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
    // Window geometry is read here, off `createWindow`'s synchronous path.
    void preloadWinState()
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
    createWindow()
    createTray(trayHandlers())
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

    // One quiet check a day. It only ever reports; nothing is downloaded or
    // applied without the user going to the release page themselves.
    void autoCheck((result: UpdateResult) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updates:available', result)
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    globalShortcut.unregisterAll()
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
