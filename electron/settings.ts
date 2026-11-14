import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { NeteaseQuality } from './netease/types'
import { libraryPaths } from './library-paths'

/**
 * The settings surface the renderer sees.
 *
 * Mirrored in `src/env.d.ts` (see the `AppSettings` block there) rather than
 * imported: the renderer and the main process are two TypeScript projects with
 * different module systems, so they share a shape by convention, the same way
 * `electron/netease/types.ts` mirrors its renderer counterpart. Change one and
 * you must change the other.
 */
export interface AppSettings {
  onlineLyrics: boolean
  updateInterval: UpdateInterval
  updateLastCheck: number
  autoInstallUpdates: boolean
  desktopLyrics: { size: number; min: number; max: number }
  /** 点窗口的关闭按钮时收进托盘，而不是退出应用。默认 true。 */
  closeToTray: boolean
  /** 开机时随系统一起启动。默认关：装完不请自来是骚扰。 */
  launchAtLogin: boolean
  /** 放歌时拦住系统休眠。默认开：一场专辑听一半黑屏睡着，是播放器最没用的失败。 */
  preventSleepWhilePlaying: boolean
  /** 下载完在资源管理器里把文件选出来。默认关：批量下十首会弹十次。 */
  openAfterDownload: boolean
  /** 点一下托盘图标：切换窗口显隐，还是只把窗口叫出来。 */
  trayClick: TrayClick
  /**
   * 锁住桌面歌词时，鼠标悬到那行字上还要不要临时接管。
   *
   * 开（默认）时悬停会浮出控制条，代价是那一下点击归歌词窗口；关掉则是完全
   * 穿透，想动它只能先解锁。
   */
  overlayHoverControls: boolean
  /** 在线音频缓存上限（MB）；0 表示不缓存。 */
  mediaCacheLimitMb: number
}

export interface StorageUsage {
  userData: string
  cache: string
  cacheBytes: number | null
  userDataBytes: number | null
}

export type UpdateInterval = 'manual' | 'daily' | 'weekly'

/**
 * 托盘图标的单击行为。
 *
 * `toggle` 是原来就有的显隐切换；`show` 只把窗口叫出来，不会把它藏起来——
 * 有些人是想点开看看，结果一点就没了。
 */
export type TrayClick = 'toggle' | 'show'

/** Bounds for the desktop lyric strip. `Overlay.tsx` mirrors these. */
export const LYRIC_SIZE_MIN = 18
export const LYRIC_SIZE_MAX = 64

export interface Settings {
  /** 旧版字段：只用来把「关掉每天检查」的人迁到 updateInterval 的 manual。 */
  autoCheckUpdates: boolean
  /** How often to check for updates. `manual` means only on request. */
  updateInterval: UpdateInterval
  /** Epoch ms of the last completed update check. */
  lastUpdateCheck: number
  /**
   * Update in the background instead of waiting to be asked.
   *
   * On by default, and it covers the whole sequence: the daily check finds a
   * release, the file is fetched, and once nothing is playing the new build is
   * installed and the app comes back on it. The one thing this flag never
   * touches is the manual 「检查更新」 button - that press only asks GitHub a
   * question, because "check" and "replace my running app" are two different
   * decisions. Turning it off makes every step manual.
   */
  autoInstallUpdates: boolean
  /**
   * Font size of the desktop lyric strip.
   *
   * Lives here rather than in the overlay window's `localStorage` because the
   * settings page has to be able to read and change it, and `localStorage` is
   * per-window: the two windows would each keep their own answer.
   */
  desktopLyricsSize: number
  /** 随系统启动。写在这里而不是只交给 app.setLoginItemSettings：注册表状态
   *  会随重装/搬迁失效，设置文件里的这一位才是「用户想要什么」。 */
  launchAtLogin: boolean
  /** 播放时阻止系统休眠与锁屏（powerSaveBlocker 的 audio 类型）。 */
  preventSleepWhilePlaying: boolean
  /** 下载完在资源管理器里把文件选出来。 */
  openAfterDownload: boolean
  /** 托盘单击行为。 */
  trayClick: TrayClick
  /** 锁住桌面歌词时，悬停是否临时接管鼠标。 */
  overlayHoverControls: boolean
  /**
   * Allow lyric lookups against lrclib.net.
   *
   * Off by default: Aurora promises the library stays on this machine, and a
   * lookup necessarily sends the track title and artist to a third party, so
   * the user turns it on rather than finding out afterwards.
   */
  onlineLyrics: boolean
  /**
   * 关闭按钮的含义。
   *
   * 音乐播放器关掉窗口还在放歌是习惯，所以默认收进托盘；但托盘在有些机器上被
   * 安全软件吞掉，那种情况下「关不掉」会变成真正的麻烦，所以留一个明确的退出开关。
   */
  closeToTray: boolean
  /**
   * Preferred quality for Netease playback.
   *
   * `exhigh` by default, not `lossless`: 320kbps is the best level an account
   * without a membership actually receives, so the default is a promise the
   * app can keep rather than one it silently downgrades.
   */
  neteaseQuality: NeteaseQuality
  /** 下载目录；空字符串表示默认的「音乐/Aurora」。 */
  downloadDir: string
  /** 下载后转成什么；original 表示原样保存。 */
  downloadFormat: 'original' | 'mp3' | 'flac' | 'm4a'
  /** 有损目标的码率（kbps）。 */
  downloadBitrate: number
  /**
   * 在线音频本地缓存的上限（MB）。0 表示不缓存。
   *
   * 缓存的是「自己听过的歌」，位置在 userData/media-cache；上限按最近使用
   * 淘汰，默认 2GB——一张专辑约 100MB，够二十张来回听。
   */
  mediaCacheLimitMb: number
  /**
   * 第一次把窗口收进托盘时，是否已经用系统气泡说明过。
   *
   * 只用一次：每个会话都弹就成了骚扰，但从来不说，用户会以为关窗把程序
   * 关了——窗口消失、声音还在，这是这套默认行为里最容易误解的一步。
   */
  trayHintShown: boolean
  /** Last position and size of the desktop lyric strip. */
  lyricsOverlayBounds?: { x: number; y: number; width: number; height: number }
}

const DEFAULTS: Settings = {
  autoCheckUpdates: true,
  updateInterval: 'daily',
  lastUpdateCheck: 0,
  /*
   * 默认只检查、不自己装。检查更新是问一句，换掉正在运行的版本是另一回事：
   * 静默装完如果被权限、杀软或单实例锁挡住，用户看到的就是「每次打开都要
   * 重装一遍」。这个开关还在，想全自动的人自己打开。
   */
  autoInstallUpdates: false,
  trayHintShown: false,
  desktopLyricsSize: 34,
  onlineLyrics: false,
  closeToTray: true,
  launchAtLogin: false,
  preventSleepWhilePlaying: true,
  openAfterDownload: false,
  trayClick: 'toggle',
  overlayHoverControls: true,
  neteaseQuality: 'exhigh',
  downloadDir: '',
  downloadFormat: 'original',
  downloadBitrate: 256,
  mediaCacheLimitMb: 2048
}

let cache: Settings | null = null

const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')

export function loadSettings(): Settings {
  if (cache) return cache
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) as Record<string, unknown>
    // The folder list moved to `library-paths.ts` once profiles got one library
    // each. Dropping the old keys here means a later save cannot write them back
    // and re-open a migration that has already happened.
    delete parsed.roots
    delete parsed.excluded
    delete parsed.rootsDiscovered
    const raw = parsed as Partial<Settings>
    /*
     * 这份文件写在「自动安装默认开」的时候：它没有 trayHintShown 这个后加的
     * 字段。那种配置正是「每次打开都要重装」的受害对象，读到时把自动安装
     * 关掉一次，并立刻写回；之后以用户在设置页选的为准。
     */
    const legacyAutoInstall = !Object.prototype.hasOwnProperty.call(parsed, 'trayHintShown')
    cache = {
      // Spread first so keys this version does not know about survive a
      // read-write cycle instead of being silently dropped.
      ...DEFAULTS,
      ...raw,
      // Enums and numbers come from a hand-editable JSON file, so they are
      // validated rather than trusted: an unknown interval would silently stop
      // update checks, and a size outside the range would render a strip that
      // cannot be read.
      updateInterval: isUpdateInterval(raw.updateInterval) ? raw.updateInterval : migrateInterval(raw),
      desktopLyricsSize: clampLyricSize(raw.desktopLyricsSize),
      closeToTray: raw.closeToTray !== false,
      launchAtLogin: raw.launchAtLogin === true,
      preventSleepWhilePlaying: raw.preventSleepWhilePlaying !== false,
      openAfterDownload: raw.openAfterDownload === true,
      trayClick: raw.trayClick === 'show' ? 'show' : 'toggle',
      trayHintShown: raw.trayHintShown === true,
      overlayHoverControls: raw.overlayHoverControls !== false,
      downloadDir: typeof raw.downloadDir === 'string' ? raw.downloadDir : '',
      downloadFormat: isDownloadFormat(raw.downloadFormat) ? raw.downloadFormat : 'original',
      downloadBitrate: clampBitrate(raw.downloadBitrate),
      mediaCacheLimitMb: clampMediaCacheLimit(raw.mediaCacheLimitMb),
      autoInstallUpdates: legacyAutoInstall ? false : raw.autoInstallUpdates === true
    }
    if (legacyAutoInstall) saveSettings({ autoInstallUpdates: false })
  } catch {
    // Missing or corrupt settings are not an error worth surfacing; start clean.
    cache = { ...DEFAULTS }
  }
  return cache
}

/**
 * Carry the old boolean forward.
 *
 * Anyone who had turned the daily check off must not quietly get it back - that
 * would be a network request they had explicitly declined - and anyone who left
 * it on keeps the behaviour they already had.
 */
function migrateInterval(raw: Partial<Settings>): UpdateInterval {
  if (raw.autoCheckUpdates === false) return 'manual'
  return DEFAULTS.updateInterval
}

function isUpdateInterval(value: unknown): value is UpdateInterval {
  return value === 'manual' || value === 'daily' || value === 'weekly'
}

function isDownloadFormat(
  value: unknown
): value is 'original' | 'mp3' | 'flac' | 'm4a' {
  return value === 'original' || value === 'mp3' || value === 'flac' || value === 'm4a'
}

function clampBitrate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULTS.downloadBitrate
  return Math.min(320, Math.max(96, Math.round(value)))
}

/** 0 是「不缓存」，所以下限就是 0；上限 10GB，再大不像音乐播放器。 */
function clampMediaCacheLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULTS.mediaCacheLimitMb
  return Math.min(10_240, Math.max(0, Math.round(value)))
}

function clampLyricSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULTS.desktopLyricsSize
  return Math.min(LYRIC_SIZE_MAX, Math.max(LYRIC_SIZE_MIN, Math.round(value)))
}

/** The subset the settings page reads, in the shape `src/env.d.ts` declares. */
export function appSettings(): AppSettings {
  const settings = loadSettings()
  return {
    onlineLyrics: settings.onlineLyrics,
    updateInterval: settings.updateInterval,
    updateLastCheck: settings.lastUpdateCheck,
    autoInstallUpdates: settings.autoInstallUpdates,
    closeToTray: settings.closeToTray !== false,
    launchAtLogin: settings.launchAtLogin === true,
    preventSleepWhilePlaying: settings.preventSleepWhilePlaying !== false,
    openAfterDownload: settings.openAfterDownload === true,
    trayClick: settings.trayClick === 'show' ? 'show' : 'toggle',
    overlayHoverControls: settings.overlayHoverControls !== false,
    mediaCacheLimitMb: clampMediaCacheLimit(settings.mediaCacheLimitMb),
    desktopLyrics: {
      size: clampLyricSize(settings.desktopLyricsSize),
      min: LYRIC_SIZE_MIN,
      max: LYRIC_SIZE_MAX
    }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...loadSettings(), ...patch }
  cache = next
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    console.error('[aurora] could not persist settings', error)
  }
  return next
}

/**
 * The single authority on what Aurora may read from disk.
 *
 * Every file-serving path (audio streaming, artwork, lyrics) funnels through
 * this, so a compromised or buggy renderer cannot use the app to read files
 * outside the folders the user actually added.
 */
export function isInsideRoots(candidate: string): boolean {
  const resolved = path.resolve(candidate)
  return libraryPaths().roots.some((root) => {
    const base = path.resolve(root)
    const withSeparator = base.endsWith(path.sep) ? base : base + path.sep
    return resolved === base || resolved.startsWith(withSeparator)
  })
}

// --- storage --------------------------------------------------------------

/**
 * Directories inside `userData` that hold nothing but regenerable cache.
 *
 * Verified against a real profile rather than assumed: on Windows, Electron
 * keeps every Chromium cache *inside* `userData`, while `app.getPath('cache')`
 * points at `%LOCALAPPDATA%\aurora-player` - a directory this app never
 * creates. Anything not on this list is left alone, which is what keeps the
 * library index, playlists, profiles, window geometry and the encrypted session
 * cookie out of reach of the "clear cache" button.
 */
export const CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'GPUPersistentCache',
  'GrShaderCache',
  'ShaderCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'blob_storage'
] as const

/** Recursive byte count. Symlinks are skipped so a link cannot double-count. */
export async function directoryBytes(target: string): Promise<number | null> {
  let total = 0
  try {
    const entries = await fs.promises.readdir(target, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(target, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        const nested = await directoryBytes(full)
        if (nested !== null) total += nested
      } else if (entry.isFile()) {
        try {
          total += (await fs.promises.stat(full)).size
        } catch {
          /* a file that vanished mid-walk contributes nothing */
        }
      }
    }
    return total
  } catch {
    return null
  }
}

export async function cacheBytes(): Promise<number | null> {
  const root = app.getPath('userData')
  let total: number | null = null
  for (const name of CACHE_DIRS) {
    const size = await directoryBytes(path.join(root, name))
    if (size === null) continue
    total = (total ?? 0) + size
  }
  return total
}

export async function storageUsage(): Promise<StorageUsage> {
  const userData = app.getPath('userData')
  return {
    userData,
    cache: userData,
    cacheBytes: await cacheBytes(),
    userDataBytes: await directoryBytes(userData)
  }
}

/**
 * Delete the regenerable caches.
 *
 * Deleting a cache directory while Chromium holds files open fails on Windows,
 * so a failure here is not an error to surface: the next launch rebuilds
 * whatever could not be removed. What must never happen is touching a path
 * outside `CACHE_DIRS`, which is why the list is a constant and the removal is
 * driven by it rather than by a caller-supplied path.
 */
export async function clearCache(): Promise<StorageUsage> {
  const root = app.getPath('userData')
  for (const name of CACHE_DIRS) {
    try {
      await fs.promises.rm(path.join(root, name), { recursive: true, force: true, maxRetries: 2 })
    } catch (error) {
      console.error('[aurora] could not clear cache directory', name, error)
    }
  }
  return storageUsage()
}
