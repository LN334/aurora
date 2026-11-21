import { BrowserWindow, screen, type Rectangle } from 'electron'
import path from 'node:path'
import { startFullscreenWatch, stopFullscreenWatch } from './fullscreen-watch'
import { APP_ORIGIN } from './protocols/app-protocol'
import {
  LYRIC_SIZE_MAX,
  LYRIC_SIZE_MIN,
  loadSettings,
  saveSettings
} from './settings'

/**
 * The desktop lyric window.
 *
 * A separate frameless, transparent, always-on-top `BrowserWindow` that floats
 * over every other window. Two behaviours are the whole design:
 *
 *  - **Locked** (the default) the window ignores the mouse entirely, so it never
 *    eats a click meant for whatever is underneath. `forward: true` keeps
 *    mouse-move delivery so hover styling still works.
 *  - **Unlocked** it can be dragged and its control strip is reachable.
 *
 * It is shown with `showInactive()` so appearing never steals focus from what the
 * user was doing - an overlay that grabs focus on launch is worse than no
 * overlay.
 */

export interface OverlayState {
  /** Current lyric line, or null when there is nothing to show. */
  text: string | null
  /** The following line, rendered dimmed underneath. */
  next: string | null
  title: string
  artist: string
  playing: boolean
  /**
   * When the current line starts and ends, in seconds.
   *
   * The strip fills the line as it is sung, which it can only do if it knows the
   * line's own span. Both are null for unsynchronised lyrics - the strip then
   * paints the line plainly instead of inventing a progress that means nothing.
   */
  at: number | null
  to: number | null
  /** Playback position at push time, in seconds. The strip dead-reckons from here. */
  position: number
  /** Track length in seconds; 0 when unknown. */
  duration: number
  /** Artwork accent colour, so the sung part matches what is playing. */
  accent: string
}

export interface OverlayStatus {
  open: boolean
  locked: boolean
  /** Font size of the strip, in px. Mirrors `src/env.d.ts`. */
  size: number
  /**
   * 窗口此刻是否真的在屏幕上。
   *
   * 和 `open` 分开：舞台或主窗全屏时窗口还开着，只是被收起来（hide），退出后
   * 原样放回来。设置页与探针都靠这一位区分「关掉了」和「暂时让位」。
   */
  visible: boolean
}

const DEV_URL = 'http://127.0.0.1:5173'
const isDev = process.argv.includes('--dev')

const DEFAULT_WIDTH = 980
const MIN_WIDTH = 320
const MIN_HEIGHT = 88

/**
 * The strip has to hold three things: the line, the next line, and the toolbar
 * that fades in underneath them on hover. The toolbar is always in the layout -
 * it only changes opacity - so the window never resizes when the pointer moves,
 * which would otherwise make the hit box jump under the cursor.
 */
function heightFor(size: number): number {
  // 一行原文、一行译文、一行下一句，再加工具栏：比只有原文的年代多出约一行
  // 小字的高度。上限仍是 320——再高就没人信它是「桌面歌词」了。
  return Math.round(Math.min(320, Math.max(140, size * 2.2 + 82)))
}

let overlay: BrowserWindow | null = null
let locked = true
/**
 * Whether the pointer is currently over the lyrics.
 *
 * This is polled in the main process rather than reported by the page: a locked
 * window ignores the mouse, and on Windows the forwarded mouse-move events do
 * not arrive at all in that state (measured, not assumed). Polling the cursor is
 * the only way to know the user is aiming at the strip.
 *
 * It matters because "locked" is not the same thing as "unusable": the window
 * ignores the mouse so it never eats a click meant for the app underneath, but
 * the moment the pointer is actually on the lyrics the buttons should work.
 * Without this the only way to reach them was a keyboard shortcut, which is the
 * "weird to operate" part of a floating widget whose controls are invisible.
 */
let hovering = false

let hoverTimer: NodeJS.Timeout | undefined
/** Held while the window is closed so it renders instantly when reopened. */
let latest: OverlayState | null = null
let notify: (status: OverlayStatus) => void = () => undefined

/**
 * 主窗自己进了全屏、用户打开舞台、或系统里别的程序占着屏幕时，桌面歌词先让开。
 *
 * 前两种是应用自己知道的事（窗口事件、舞台开关），第三种要问系统：Windows 的
 * `SHQueryUserNotificationState` 会说「全屏应用在跑」或「演示模式」，Electron
 * 没有绑定，交给 fullscreen-watch 常驻轮询。三路各占一位，谁都不该顺手撤掉别人
 * 那一份抑制。
 *
 * 只 hide 不 destroy：恢复时 `showInactive` 就够，重开窗口会白等一次渲染。
 */
const hiddenReasons = new Set<'app' | 'system'>()

function applySuppressed(): void {
  if (!overlay || overlay.isDestroyed()) return
  if (hiddenReasons.size > 0) {
    if (overlay.isVisible()) overlay.hide()
    return
  }
  overlay.showInactive()
}

function setSuppressedReason(reason: 'app' | 'system', next: boolean): boolean {
  const wanted = Boolean(next)
  if (wanted === hiddenReasons.has(reason)) return hiddenReasons.size > 0
  if (wanted) hiddenReasons.add(reason)
  else hiddenReasons.delete(reason)
  applySuppressed()
  return hiddenReasons.size > 0
}

export function setOverlaySuppressed(next: boolean): boolean {
  return setSuppressedReason('app', next)
}

/** 系统里别的程序全屏了，来自 fullscreen-watch 的轮询。 */
function setOverlaySuppressedBySystem(next: boolean): boolean {
  return setSuppressedReason('system', next)
}

export function initOverlay(onStatus: (status: OverlayStatus) => void): void {
  notify = onStatus
}

function notifyStatus(): void {
  notify(status())
}

function defaultBounds(): Rectangle {
  const { workArea } = screen.getPrimaryDisplay()
  const height = heightFor(lyricSize())
  const width = Math.min(DEFAULT_WIDTH, Math.round(workArea.width * 0.72))
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - 72)
  }
}

/**
 * Keep the strip on a display that exists.
 *
 * Monitors get unplugged and resolutions change; a saved position from last
 * month can land entirely off-screen, which looks exactly like the feature being
 * broken.
 */
function clampBounds(bounds: Rectangle): Rectangle {
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea

  const width = Math.min(Math.max(bounds.width, MIN_WIDTH), area.width)
  const height = Math.min(Math.max(bounds.height, MIN_HEIGHT), area.height)
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)

  return { x, y, width, height }
}

/**
 * 锁住时悬停要不要临时接管，读设置里那一位。
 *
 * 默认开：锁住只是「平时不挡」，不是「永远动不了」。关掉的人要的是绝对穿透，
 * 那就连悬停也不许接管。
 */
function hoverTakesOver(): boolean {
  return loadSettings().overlayHoverControls !== false
}

/**
 * 锁定态下「唤醒带」的高度。
 *
 * 锁定后整窗穿透，但要留一条能把控制条叫出来的路——否则那颗锁按钮永远
 * 点不到，等于把自己锁在外面。这条带由主进程按窗口矩形自己算，不依赖页面
 * 上报的坐标：上一次判定不可靠，正是因为用的是渲染层传上来的矩形，窗口挪动
 * 或缩放之后它会过期。
 */
const WAKE_ZONE_HEIGHT = 64

let pointerInWakeZone = false

function applyLock(): void {
  if (!overlay || overlay.isDestroyed()) return
  /*
   * 未锁定：整窗可交互（要能拖动）。
   * 锁定：整窗穿透，只有指针进入底部那条唤醒带时临时接管。
   */
  const wake = locked && hoverTakesOver() && pointerInWakeZone
  overlay.setIgnoreMouseEvents(!(!locked || wake), { forward: true })
}

/** Tell the strip what the pointer is doing so it can reveal its controls. */
function notifyHover(): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.webContents.send('overlay:hover', hovering)
}

function stopHoverPolling(): void {
  if (hoverTimer) clearInterval(hoverTimer)
  hoverTimer = undefined
}

/**
 * Watch the cursor while the strip is locked.
 *
 * 70ms is well under the time it takes to move a pointer onto the strip, and
 * the check itself is two rectangle tests against a cached bounds read.
 */
function startHoverPolling(): void {
  stopHoverPolling()
  hoverTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed() || !locked) return
    // 关掉「锁住时也能悬停」就别再接管：把状态压回未悬停，窗口保持完全穿透。
    // 定时器留着不关，用户把开关打开时下一次 tick 就能恢复，不用重开窗口。
    /* 锁定态不看悬停：控制条只随锁定开关走，这里保持 false。 */
    if (locked || !hoverTakesOver()) {
      setHovering(false)
      return
    }
    const point = screen.getCursorScreenPoint()
    const bounds = overlay.getBounds()
    /*
     * 唤醒带贴着窗口底边：控制条就长在那附近，鼠标过去自然是想操作它。
     * 这里只用主进程自己拿得到的两个值（光标、窗口矩形），页面坐标一概不用。
     */
    pointerInWakeZone =
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y + bounds.height - WAKE_ZONE_HEIGHT &&
      point.y <= bounds.y + bounds.height
    setHovering(pointerInWakeZone)
    applyLock()
    return
  }, 70)
}

function sendState(): void {
  if (!latest || !overlay || overlay.isDestroyed()) return
  overlay.webContents.send('overlay:state', latest)
}

/**
 * Send the font size to the overlay window.
 *
 * Called on open and on every change; `lastSize` keeps the open path from
 * re-sending on every status update, which happens on show/hide/move too.
 */
let lastSize = 0

function sendSize(force = false): void {
  if (!overlay || overlay.isDestroyed()) return
  const size = lyricSize()
  if (!force && size === lastSize) return
  lastSize = size
  overlay.webContents.send('overlay:size', size)
}

function persistBounds(): void {
  if (!overlay || overlay.isDestroyed()) return
  saveSettings({ lyricsOverlayBounds: overlay.getBounds() })
}

export function status(): OverlayStatus {
  return {
    open: overlay !== null && !overlay.isDestroyed(),
    locked,
    size: lyricSize(),
    visible: Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible())
  }
}

/** The size the strip should render at, read from the shared settings. */
function lyricSize(): number {
  const size = loadSettings().desktopLyricsSize
  return Math.min(LYRIC_SIZE_MAX, Math.max(LYRIC_SIZE_MIN, Math.round(size)))
}

/**
 * Change the strip's font size.
 *
 * The value lives in the main process because two windows need it: the settings
 * page writes it and the overlay renders it. Keeping it in the overlay's own
 * `localStorage` - as it was - meant the settings page could not see or change
 * it at all.
 */
export function setLyricSize(size: number): number {
  const next = Math.min(LYRIC_SIZE_MAX, Math.max(LYRIC_SIZE_MIN, Math.round(size)))
  saveSettings({ desktopLyricsSize: next })
  if (overlay && !overlay.isDestroyed()) {
    /*
     * A bigger font needs a taller window, and the extra room has to come from
     * above: growing downwards would push the strip onto the taskbar from the
     * position the user had already settled on.
     *
     * Only ever grows. A window the user pulled taller by hand keeps its height -
     * dragging is a deliberate act and silently undoing it on the next font nudge
     * would read as the resize not sticking.
     */
    const bounds = overlay.getBounds()
    const height = heightFor(next)
    if (height > bounds.height) {
      overlay.setBounds({ ...bounds, y: bounds.y + bounds.height - height, height })
    }
    overlay.webContents.send('overlay:size', next)
  }
  notifyStatus()
  return next
}

function open(): void {
  if (overlay && !overlay.isDestroyed()) {
    if (hiddenReasons.size === 0) overlay.showInactive()
    sendState()
    sendSize(true)
    notifyStatus()
    startFullscreenWatch(setOverlaySuppressedBySystem)
    return
  }

  const saved = loadSettings().lyricsOverlayBounds
  // A position saved before the strip grew a toolbar can be too short for the
  // words it now has to hold; keep the user's width and x/y, insist on the height.
  const bounds = clampBounds(
    saved ? { ...saved, height: Math.max(saved.height, heightFor(lyricSize())) } : defaultBounds()
  )

  overlay = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: true,
    // A transparent window still needs an explicit fully-transparent colour, or
    // Windows paints it black.
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    title: 'Aurora 桌面歌词',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The strip must keep updating while the player window is minimised.
      backgroundThrottling: false
    }
  })

  // 'screen-saver' is above full-screen apps, which is what a lyric overlay is
  // for. Plain alwaysOnTop is not enough over a full-screen video or game.
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  applyLock()

  overlay.once('ready-to-show', () => {
    if (hiddenReasons.size === 0) overlay?.showInactive()
    sendState()
    sendSize(true)
    notifyHover()
  })

  startHoverPolling()

  overlay.on('closed', () => {
    overlay = null
    hovering = false
    stopFullscreenWatch()
    hiddenReasons.delete('system')
    notifyStatus()
  })

  let saveTimer: NodeJS.Timeout | undefined
  const saveSoon = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistBounds, 500)
  }
  overlay.on('moved', saveSoon)
  overlay.on('resized', saveSoon)
  overlay.on('show', notifyStatus)
  overlay.on('hide', notifyStatus)

  if (isDev) {
    void overlay.loadURL(`${DEV_URL}/overlay.html`)
  } else {
    // Same private-scheme reason as the main window.
    void overlay.loadURL(`${APP_ORIGIN}/overlay.html`)
  }

  notifyStatus()
  startFullscreenWatch(setOverlaySuppressedBySystem)
}

function close(): void {
  if (!overlay || overlay.isDestroyed()) {
    overlay = null
    stopFullscreenWatch()
    hiddenReasons.delete('system')
    notifyStatus()
    return
  }
  persistBounds()
  stopHoverPolling()
  stopFullscreenWatch()
  hiddenReasons.delete('system')
  overlay.destroy()
  overlay = null
  hovering = false
  notifyStatus()
}

export function toggleOverlay(force?: boolean): OverlayStatus {
  const want = force ?? !status().open
  if (want) open()
  else close()
  return status()
}

export function setLocked(next: boolean): boolean {
  locked = next
  applyLock()
  notifyStatus()
  return locked
}

/**
 * 设置里「锁住时也能悬停」改过之后立刻生效。
 *
 * 不重开窗口：轮询本来就在跑，把状态压回未悬停、再算一次穿透就够了。
 */
export function applyOverlayHoverSetting(): void {
  if (!hoverTakesOver()) setHovering(false)
  applyLock()
}

export function isLocked(): boolean {
  return locked
}

/**
 * The strip tells us when the pointer enters or leaves it.
 *
 * Only meaningful while locked - an unlocked window always takes the mouse.
 * Returns the state actually applied.
 */
function setHovering(next: boolean): boolean {
  if (hovering === next) return hovering
  hovering = next
  applyLock()
  notifyHover()
  return hovering
}

/** 工具栏那一块的矩形，锁定后只有它会接管鼠标。 */
export function setToolbarArea(rect: unknown): boolean {
  if (!rect || typeof rect !== 'object') return false
  const candidate = rect as Partial<{ x: number; y: number; width: number; height: number }>
  return Boolean(candidate)
}

/** 渲染层上报的歌词矩形。唤醒带改为按窗口几何自算之后，这里不再使用它。 */
export function setHitArea(rect: unknown): boolean {
  return Boolean(rect && typeof rect === 'object')
}

/** Forward the current lyric state. Safe to call whether or not the window is open. */
export function pushOverlayState(state: OverlayState): void {
  latest = state
  sendState()
}

/** Used while quitting, so the overlay does not outlive the app. */
export function destroyOverlay(): void {
  stopFullscreenWatch()
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  overlay = null
}
