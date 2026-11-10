import { BrowserWindow, screen, type Rectangle } from 'electron'
import path from 'node:path'
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
  return Math.round(Math.min(320, Math.max(120, size * 1.875 + 76)))
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

/**
 * Where the words are, in window-local CSS px.
 *
 * The window is much wider than the line it draws. Handing the whole rectangle
 * to the mouse would make an invisible 980x150 area swallow clicks aimed at the
 * desktop, so the page reports the plate's own box and only that counts.
 */
let hitArea: { x: number; y: number; width: number; height: number } | null = null

let hoverTimer: NodeJS.Timeout | undefined
/** Held while the window is closed so it renders instantly when reopened. */
let latest: OverlayState | null = null
let notify: (status: OverlayStatus) => void = () => undefined

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

function applyLock(): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.setIgnoreMouseEvents(locked && !(hovering && hoverTakesOver()), { forward: true })
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
    if (!hoverTakesOver()) {
      setHovering(false)
      return
    }
    const point = screen.getCursorScreenPoint()
    const bounds = overlay.getBounds()
    const area = hitArea ?? { x: 0, y: 0, width: bounds.width, height: bounds.height }
    // A few px of slack on each edge: the plate is rounded and thin, and
    // aiming at a target that only answers when you are exactly on it feels
    // broken.
    const pad = 10
    const inside =
      point.x >= bounds.x + area.x - pad &&
      point.x <= bounds.x + area.x + area.width + pad &&
      point.y >= bounds.y + area.y - pad &&
      point.y <= bounds.y + area.y + area.height + pad
    setHovering(inside)
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
    size: lyricSize()
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
    overlay.showInactive()
    sendState()
    sendSize(true)
    notifyStatus()
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
    overlay?.showInactive()
    sendState()
    sendSize(true)
    notifyHover()
  })

  startHoverPolling()

  overlay.on('closed', () => {
    overlay = null
    hovering = false
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
}

function close(): void {
  if (!overlay || overlay.isDestroyed()) {
    overlay = null
    notifyStatus()
    return
  }
  persistBounds()
  stopHoverPolling()
  overlay.destroy()
  overlay = null
  hovering = false
  hitArea = null
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
export function setHovering(next: boolean): boolean {
  if (hovering === next) return hovering
  hovering = next
  applyLock()
  notifyHover()
  return hovering
}

/** The strip's own box, so hovering only counts on the words themselves. */
export function setHitArea(rect: unknown): boolean {
  if (!rect || typeof rect !== 'object') return false
  const candidate = rect as Partial<{ x: number; y: number; width: number; height: number }>
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)
  const area = {
    x: num(candidate.x),
    y: num(candidate.y),
    width: Math.max(1, num(candidate.width)),
    height: Math.max(1, num(candidate.height))
  }
  hitArea = area
  return true
}

/** Forward the current lyric state. Safe to call whether or not the window is open. */
export function pushOverlayState(state: OverlayState): void {
  latest = state
  sendState()
}

/** Used while quitting, so the overlay does not outlive the app. */
export function destroyOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  overlay = null
}
