import { useEffect, useState } from 'react'
import { bridge, isNative } from '../../bridge'
import type {
  AppSettings,
  JunkId,
  JunkScan,
  MemoryRelease,
  OverlayAlign,
  StorageUsage,
  TrayClick,
  UpdateInterval,
  UpdatePrefs
} from '../../env'

/**
 * The settings page's state.
 *
 * A plain hook rather than a store: settings are read once when the page opens
 * and written straight through to the main process, which owns the truth. There
 * is no cross-view subscription to keep in sync, so a store would only add a
 * second copy of every value that could drift from the file on disk.
 */

/** Mirrors the defaults in `electron/settings.ts` so the preview has something sane. */
const FALLBACK_SETTINGS: AppSettings = {
  onlineLyrics: false,
  updateInterval: 'daily',
  updateLastCheck: 0,
  desktopLyrics: { size: 34, min: 18, max: 64 },
  closeToTray: true,
  launchAtLogin: false,
  preventSleepWhilePlaying: true,
  openAfterDownload: false,
  trayClick: 'toggle',
  overlayHoverControls: true,
  mediaCacheLimitMb: 2048,
  zoomFactor: 1,
  minimizeToTray: false,
  overlayNextLine: true,
  overlayTranslation: true,
  overlayAlign: 'center'
}

 interface SettingsPage {
  settings: AppSettings
  prefs: UpdatePrefs
  storage: StorageUsage | null
  /** Last update result, including download progress. */
  clearing: boolean
  /** 上次「释放内存」的结果；null 表示这次打开页面后还没点过。 */
  memory: MemoryRelease | null
  memoryBusy: boolean
  /** 垃圾扫描结果。不自动扫描：量目录要遍历磁盘，进页面就扫会拖慢首屏。 */
  junk: JunkScan | null
  junkBusy: boolean
  /** True while a write is in flight, so controls can be disabled. */
  busy: boolean
  error: string | null

  setOnlineLyrics(enabled: boolean): Promise<void>
  setLyricsSize(size: number): Promise<void>
  setUpdateInterval(interval: UpdateInterval): Promise<void>
  /** 关闭按钮：收进托盘（true）或退出应用（false）。 */
  setCloseToTray(enabled: boolean): Promise<void>
  /** 开机自启。主进程负责系统登录项，未打包时只保存意愿。 */
  setLaunchAtLogin(enabled: boolean): Promise<void>
  /** 播放时阻止系统挂起。 */
  setPreventSleep(enabled: boolean): Promise<void>
  /** 下载完在资源管理器里把文件选出来。 */
  setOpenAfterDownload(enabled: boolean): Promise<void>
  /** 托盘单击：切换显隐，还是只叫出来。 */
  setTrayClick(mode: TrayClick): Promise<void>
  /** 锁住桌面歌词时，悬停是否临时接管鼠标。 */
  setOverlayHoverControls(enabled: boolean): Promise<void>
  /** 在线音频缓存上限（MB）；0 表示不缓存。 */
  setMediaCacheLimit(megabytes: number): Promise<void>
  /** 界面缩放，1 = 100%。 */
  setZoomFactor(factor: number): Promise<void>
  /** 最小化按钮收进托盘。 */
  setMinimizeToTray(enabled: boolean): Promise<void>
  /** 桌面歌词显示下一句。 */
  setOverlayNextLine(enabled: boolean): Promise<void>
  /** 桌面歌词显示译文。 */
  setOverlayTranslation(enabled: boolean): Promise<void>
  /** 桌面歌词对齐。 */
  setOverlayAlign(align: OverlayAlign): Promise<void>
  /** 恢复默认；localStorage 由设置页清。 */
  resetAll(): Promise<void>
  clearCache(): Promise<void>
  refreshStorage(): Promise<void>
  releaseMemory(): Promise<void>
  scanJunk(): Promise<void>
  cleanJunk(ids: JunkId[]): Promise<void>
}

export function useSettingsPage(): SettingsPage {
  const [settings, setSettings] = useState<AppSettings>(FALLBACK_SETTINGS)
  const [prefs, setPrefs] = useState<UpdatePrefs>({
    interval: 'manual',
    lastCheck: 0
  })
  const [storage, setStorage] = useState<StorageUsage | null>(null)
  const [clearing, setClearing] = useState(false)
  const [memory, setMemory] = useState<MemoryRelease | null>(null)
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [junk, setJunk] = useState<JunkScan | null>(null)
  const [junkBusy, setJunkBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [loaded, updatePrefs] = await Promise.all([
          bridge.settings.getAll(),
          bridge.updates.getPrefs()
        ])
        if (cancelled) return
        setSettings(loaded)
        setPrefs(updatePrefs)
        // 数据目录占用要递归扫一遍（本机 500 MB 约 1.1 秒），不能挡住这一页先出来
        void bridge.settings
          .getStorage()
          .then((usage) => {
            if (!cancelled) setStorage(usage)
          })
          .catch(() => {})
      } catch (problem) {
        if (!cancelled) setError(describe(problem))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /*
   * The main process pushes every update transition: the manual check, the
   * background check, download progress and readiness. Subscribing once here
   * means the page never has to poll or guess.
   */

  /** One wrapper for writes, so every setter reports failure the same way. */
  const write = async <T,>(action: () => Promise<T>, apply: (value: T) => void) => {
    setBusy(true)
    setError(null)
    try {
      apply(await action())
    } catch (problem) {
      setError(describe(problem))
    } finally {
      setBusy(false)
    }
  }

  return {
    settings,
    prefs,
    storage,
    clearing,
    memory,
    memoryBusy,
    junk,
    junkBusy,
    busy,
    error,

    setOnlineLyrics: (enabled) =>
      write(
        () => bridge.settings.setOnlineLyrics(enabled),
        (next) => setSettings(next)
      ),

    setLyricsSize: (size) =>
      write(
        () => bridge.settings.setDesktopLyricsSize(size),
        (next) => setSettings(next)
      ),

    setUpdateInterval: (interval) =>
      write(
        () => bridge.updates.setInterval(interval),
        (next) => {
          setPrefs(next)
          // 这一页的选中态读的是 settings，只写 prefs 会让按钮点完看着没动。
          setSettings((prev) => ({ ...prev, updateInterval: next.interval }))
        }
      ),

    /*
     * 关闭行为由主窗口的 close 处理兑现，所以这里只是把意愿写下去；
     * 返回值是整个 AppSettings，照抄服务端的答案而不是本地猜。
     */
    setCloseToTray: (enabled) =>
      write(
        () => bridge.settings.setCloseToTray(enabled),
        (next) => setSettings(next)
      ),

    setLaunchAtLogin: (enabled) =>
      write(
        () => bridge.settings.setLaunchAtLogin(enabled),
        (next) => setSettings(next)
      ),

    setPreventSleep: (enabled) =>
      write(
        () => bridge.settings.setPreventSleep(enabled),
        (next) => setSettings(next)
      ),

    setOpenAfterDownload: (enabled) =>
      write(
        () => bridge.settings.setOpenAfterDownload(enabled),
        (next) => setSettings(next)
      ),

    setTrayClick: (mode) =>
      write(
        () => bridge.settings.setTrayClick(mode),
        (next) => setSettings(next)
      ),

    setOverlayHoverControls: (enabled) =>
      write(
        () => bridge.settings.setOverlayHoverControls(enabled),
        (next) => setSettings(next)
      ),

    setMediaCacheLimit: (megabytes) =>
      write(
        () => bridge.settings.setMediaCacheLimit(megabytes),
        (next) => setSettings(next)
      ),

    setZoomFactor: (factor) =>
      write(
        () => bridge.settings.setZoomFactor(factor),
        (next) => setSettings(next)
      ),

    setMinimizeToTray: (enabled) =>
      write(
        () => bridge.settings.setMinimizeToTray(enabled),
        (next) => setSettings(next)
      ),

    setOverlayNextLine: (enabled) =>
      write(
        () => bridge.settings.setOverlayNextLine(enabled),
        (next) => setSettings(next)
      ),

    setOverlayTranslation: (enabled) =>
      write(
        () => bridge.settings.setOverlayTranslation(enabled),
        (next) => setSettings(next)
      ),

    setOverlayAlign: (align) =>
      write(
        () => bridge.settings.setOverlayAlign(align),
        (next) => setSettings(next)
      ),

    resetAll: () => write(
      () => bridge.settings.resetAll(),
      (next) => setSettings(next)
    ),

    async clearCache() {
      setClearing(true)
      setError(null)
      try {
        setStorage(await bridge.settings.clearCache())
      } catch (problem) {
        setError(describe(problem))
      } finally {
        setClearing(false)
      }
    },

    async refreshStorage() {
      try {
        setStorage(await bridge.settings.getStorage())
      } catch (problem) {
        setError(describe(problem))
      }
    },

    async releaseMemory() {
      setMemoryBusy(true)
      setError(null)
      try {
        setMemory(await bridge.maintenance.memory())
      } catch (problem) {
        setError(describe(problem))
      } finally {
        setMemoryBusy(false)
      }
    },

    async scanJunk() {
      setJunkBusy(true)
      setError(null)
      try {
        setJunk(await bridge.maintenance.scan())
      } catch (problem) {
        setError(describe(problem))
      } finally {
        setJunkBusy(false)
      }
    },

    async cleanJunk(ids) {
      setJunkBusy(true)
      setError(null)
      try {
        setJunk(await bridge.maintenance.clean(ids))
      } catch (problem) {
        setError(describe(problem))
      } finally {
        setJunkBusy(false)
      }
    }
  }
}

function describe(problem: unknown): string {
  const message = problem instanceof Error ? problem.message : String(problem)
  return isNative ? message : `${message}（浏览器预览模式）`
}

/** Human-readable byte size. `null` means "could not be measured". */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '无法测量'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

