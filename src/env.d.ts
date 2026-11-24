import type { BilibiliApi, KugouApi, NeteaseApi, QishuiApi, QqApi } from './env-types/platforms'
import type { PartyApi } from './env-types/party'
/// <reference types="vite/client" />

import type { Track } from './types'

/**
 * The bridge surface the renderer depends on, declared here rather than
 * imported from the main process so main-process code never leaks into the
 * page bundle. Optional because the renderer must also run in a plain browser,
 * where `src/bridge.ts` substitutes an in-memory implementation.
 */

export interface ScanProgress {
  phase: 'walking' | 'reading' | 'done'
  found: number
  scanned: number
  cached: number
  current: string
}

export interface LibraryIndex {
  version: number
  scannedAt: number
  roots: string[]
  tracks: Track[]
}

/** 一家后端的状态，渲染层用得到的部分。 */
interface PlatformStatusView {
  id: 'netease' | 'qq' | 'kugou' | 'qishui'
  /** idle 没拉起、starting 正在拉、ready 可用、error 失败、offline 断网。 */
  state: 'idle' | 'starting' | 'ready' | 'error' | 'offline'
  /** 一句人话；正常时是空串。 */
  detail: string
  /** 账号是否登录着；未知是 null。 */
  loggedIn: boolean | null
  /** 最近一次变化的时间戳。 */
  at: number
}

/** 开屏期的平台预热：只做与账号无关的冷启动，重复调用安全。 */
interface PlatformsApi {
  warmUp(ids: string[]): Promise<{ warmed: number; total: number }>
  /** 每个平台在当前档案下登录过没有。只读会话文件，不拉起任何后端。 */
  signedIn(): Promise<Record<string, boolean>>
  /** 四家后端的当前状态，外加一句能直接显示给人看的摘要。 */
  status(): Promise<{ list: PlatformStatusView[]; summary: string }>
  /** 让某一家重新拉起。立即返回，结果从 onStatus 回来。 */
  retry(id: string): Promise<{ ok: boolean; reason?: string }>
  /** 订阅状态变化；返回取消订阅的函数。 */
  onStatus(handler: (payload: { list: PlatformStatusView[]; summary: string }) => void): () => void
}

 interface LibraryApi {
  /**
   * Point the library at a profile.
   *
   * Folders and the scan index are per profile. Call this on every switch,
   * before reading either, and use the reply as the new folder list.
   */
  useProfile(profileId: string | null): Promise<string[]>
  getRoots(): Promise<string[]>
  /**
   * One-time search for music already on this machine.
   *
   * Returns what it added, which is empty when the pass has already run or the
   * library is already configured - an intentionally removed folder must stay
   * removed.
   */
  autoDiscover(): Promise<{ added: string[]; roots: string[] }>
  addRoots(): Promise<string[]>
  removeRoot(root: string): Promise<string[]>
  /** Raw LRC text from a sidecar file next to the audio, or null. */
  readLyrics(trackPath: string): Promise<string | null>
  /** Ask the OS file manager to show this file. False if it is outside the library. */
  reveal(trackPath: string): Promise<boolean>
  getIndex(): Promise<LibraryIndex>
  scan(): Promise<LibraryIndex>
  cancelScan(): Promise<boolean>
  onProgress(handler: (progress: ScanProgress) => void): () => void
}

 interface PlaylistsApi {
  /** Opens a file picker and returns the m3u text plus its directory. */
  import(): Promise<{ name: string; dir: string; text: string } | null>
  export(name: string, text: string): Promise<boolean>
}

/**
 * Whether the player window is on screen, as the main process sees it.
 *
 * Deliberately not focus- or occlusion-based: a window that is visible but
 * blurred, or covered by another app, is still being composited and must keep
 * rendering at full rate. Only "hidden to the tray" and "minimised" count.
 */
export interface WindowVisibilityState {
  visible: boolean
  minimized: boolean
  hidden: boolean
}

 interface AppApi {
  /** 在系统浏览器里打开外链；主进程只放行 GitHub。 */
  openExternal(url: string): Promise<boolean>
  /** 写系统剪贴板。页面里的 navigator.clipboard 在这个协议下不可用。 */
  copy(text: string): Promise<boolean>
  /** 读系统剪贴板；页面里的 navigator.clipboard 在这个协议下不可用。 */
  readClipboard(): Promise<string>
  /** 显卡加速各管线状态；设置页据此提示「现在在软渲染」。 */
  gpuStatus(): Promise<{ features: Record<string, string>; summary: string }>
  /** 各进程内存，已按 Chromium 进程类型归好；`line` 是可以直接显示的一句。 */
  metrics(): Promise<{
    summary: {
      totalMb: number
      byType: Array<{ type: string; mb: number; processes: number }>
      processes: number
    }
    line: string
    parts: string
  }>
  /** 重启应用（导入备份之后要让新的数据重新加载一次）。 */
  relaunch(): Promise<void>
  getVisibility(): Promise<WindowVisibilityState>
  onVisibility(handler: (state: WindowVisibilityState) => void): () => void
  /** 窗口正被拖着改大小；true 期间界面该关掉毛玻璃这类重采样效果。 */
  onResizing(handler: (resizing: boolean) => void): () => void
  /** 现在用的是不是用户自己设的图标，外加一张可以直接塞进 img 的预览。 */
  getIcon(): Promise<{ custom: boolean; dataUrl: string }>
  /** 开系统文件对话框挑一张图；用户点取消时 canceled 为 true。 */
  chooseIcon(): Promise<{ ok: boolean; canceled?: boolean; reason?: string }>
  /** 退回自带图标。 */
  resetIcon(): Promise<boolean>
  /** 把诊断日志导成文件（已脱敏）；用户取消保存时是空串。 */
  exportLogs(): Promise<string>
  /** 上一次是不是异常退出；读完即清，只提示一次。 */
  crashReport(): Promise<{ at: string; summary: string } | null>
}

export interface UpdateInfo {
  version: string
  name: string
  notes: string
  url: string
  publishedAt: string
  /** 安装包字节数；发布页没有安装包附件时为 0。 */
  size: number
}

/**
 * Mirrors the main process union. `unconfigured` is a real state, not an error:
 * a fresh clone has placeholder publish settings and must say so rather than
 * claim it is up to date.
 *
 * `origin` on `ready` says which path produced the file: the automatic one may
 * be installed once nothing is playing, a manual download always waits for the
 * button.
 */
export type UpdateResult =
  | { state: 'current'; current: string; checkedAt: number }
  | { state: 'available'; current: string; checkedAt: number; info: UpdateInfo }
  | { state: 'unconfigured'; current: string; message: string }
  | {
      state: 'error'
      current: string
      checkedAt: number
      message: string
      /** 下载失败时也带着这一版的信息，界面才有地方打开它的发布页。 */
      info?: UpdateInfo
    }
  | { state: 'downloading'; current: string; info: UpdateInfo; percent: number; transferred: number; total: number }
  | { state: 'ready'; current: string; info: UpdateInfo; origin: 'auto' | 'manual' }
  | { state: 'installing'; current: string; info: UpdateInfo }

/** How often the background check runs. `manual` means "only when I ask". */
export type UpdateInterval = 'manual' | 'daily' | 'weekly'

/** 托盘图标的单击行为，镜像 `electron/settings.ts` 的同名类型。 */
export type TrayClick = 'toggle' | 'show'

export interface UpdatePrefs {
  interval: UpdateInterval
  /** Epoch ms of the last completed check, 0 when it has never run. */
  lastCheck: number
}

/** 下载：主进程队列，渲染层只发命令、听状态。 */
export type DownloadFormat = 'original' | 'mp3' | 'flac' | 'm4a'
export type DownloadState =
  | 'queued'
  | 'downloading'
  | 'transcoding'
  | 'done'
  | 'failed'
  | 'canceled'

export interface DownloadRequest {
  provider: 'netease' | 'qq' | 'kugou' | 'qishui'
  trackId: string
  title: string
  artists: string[]
  album: string
  /** 秒；只用来给转码画进度。 */
  duration?: number
  format?: DownloadFormat
}

export interface DownloadView {
  id: string
  provider: DownloadRequest['provider']
  title: string
  subtitle: string
  format: DownloadFormat
  state: DownloadState
  percent: number
  received: number
  total: number
  speed: number
  filePath?: string
  message?: string
  createdAt: number
}

export interface DownloadPrefs {
  dir: string
  effectiveDir: string
  format: DownloadFormat
  bitrate: number
  ffmpeg: boolean
}

interface DownloadsApi {
  enqueue(request: DownloadRequest): Promise<DownloadView>
  cancel(id: string): Promise<boolean>
  list(): Promise<DownloadView[]>
  clear(): Promise<boolean>
  reveal(id: string): Promise<boolean>
  openFolder(): Promise<boolean>
  getPrefs(): Promise<DownloadPrefs>
  setPrefs(patch: { dir?: string; format?: DownloadFormat; bitrate?: number }): Promise<DownloadPrefs>
  pickFolder(): Promise<string | null>
  onState(handler: (views: DownloadView[]) => void): () => void
}

 interface UpdatesApi {
  check(): Promise<UpdateResult>
  /** Fetch the release the last check reported; progress arrives on `onStatus`. */
  download(): Promise<boolean>
  open(url: string): Promise<boolean>
  getPrefs(): Promise<UpdatePrefs>
  setInterval(interval: UpdateInterval): Promise<UpdatePrefs>
  /** Only meaningful in the `ready` state; quits and installs. */
  install(): Promise<boolean>
  /** Live status: checks, download progress, readiness. */
  onStatus(handler: (result: UpdateResult) => void): () => void
  onAvailable(handler: (result: UpdateResult) => void): () => void
}

/** Read-only facts about what Aurora stores on this machine. */
export interface StorageUsage {
  userData: string
  cache: string
  /** Bytes on disk, or null when the directory could not be measured. */
  cacheBytes: number | null
  userDataBytes: number | null
}

/**
 * 「释放内存」的结果。
 *
 * 工作集是操作系统能看到的那部分物理内存；让出去之后页面本身还在，
 * 只是下次访问要重新从页面文件换入，所以播放不会中断。
 */
export interface MemoryRelease {
  freedBytes: number
  processes: number
}

/** 可清理的三类垃圾。都是可再生数据，不包含曲库、歌单、档案与登录状态。 */
export type JunkId = 'cache' | 'logs' | 'crashes'

export interface JunkPart {
  id: JunkId
  label: string
  /** 占用字节；null 表示这个位置测不到。 */
  bytes: number | null
}

export interface JunkScan {
  parts: JunkPart[]
  totalBytes: number
  /**
   * 这次清理里暂时删不掉的字节数，已排进下次启动的清单。
   *
   * Chromium 运行期间握着缓存文件的句柄，Windows 不允许删除；所以点清理后
   * 有一部分只能等下次启动最早期再删。界面用这句话解释数字为什么没立刻归零。
   */
  deferredBytes: number
  /** 这次清理实际让占用下降了多少（清理前后两次测量之差）。 */
  cleanedBytes: number
}

/** 备份的结果：成功时给出一句话摘要，失败时给出能读的原因。 */
type BackupExportOutcome =
  | { ok: true; path: string; summary: string }
  | { ok: false; reason: string }

type BackupRestoreOutcome =
  | { ok: true; storage: Record<string, string>; summary: string; kept: string }
  | { ok: false; reason: string }

/** 维护：只动本应用自己的进程与目录，不接受任何外部路径。 */
interface MaintenanceApi {
  memory(): Promise<MemoryRelease>
  scan(): Promise<JunkScan>
  clean(ids: JunkId[]): Promise<JunkScan>
  /**
   * 导出备份。
   *
   * 持久化键由渲染层打包传进去 —— localStorage 只有渲染层读得到；主进程
   * 负责选路径、写文件，并按白名单决定哪些文件进备份。
   */
  exportBackup(storage: Record<string, string>): Promise<BackupExportOutcome>
  /** 导入备份。会话文件不在名单里，登录状态不会跟着搬家。 */
  restoreBackup(): Promise<BackupRestoreOutcome>
  /** 在资源管理器里打开数据目录；路径固定，不接受外部传入。 */
  openDataDir(): Promise<void>
}

export type MediaCommand = 'toggle' | 'next' | 'prev' | 'volume-up' | 'volume-down'

 interface PlayerApi {
  reportState(state: { playing: boolean }): Promise<boolean>
  onCommand(handler: (command: MediaCommand) => void): () => void
}

export interface LyricsQuery {
  title: string
  artist: string
  album: string
  /** Seconds; LRCLIB matches on this, so an accurate duration matters. */
  duration: number
}

export interface LyricsHit {
  text: string
  origin: 'cache' | 'lrclib'
  trackName: string
  artistName: string
  synced: boolean
}

 interface LyricsApi {
  lookup(query: LyricsQuery): Promise<LyricsHit | null>
  isOnlineEnabled(): Promise<boolean>
  setOnlineEnabled(enabled: boolean): Promise<boolean>
}

export interface OverlayState {
  text: string | null
  next: string | null
  title: string
  artist: string
  playing: boolean
  /**
   * 当前行的起止时间（秒）。
   *
   * 桌面歌词要按「这一句唱到哪儿了」着色，所以时间轴得跟着歌词一起过来。
   * 没有同步歌词时两者都是 null，那一行就整句白着，不做假扫描。
   */
  at: number | null
  to: number | null
  /** 推送瞬间的播放位置（秒）。桌面窗据此本地走时，不必每帧跨进程问。 */
  position: number
  /** 曲长（秒）；0 表示还不知道。 */
  duration: number
  /** 当前行的逐字时间（秒）。空数组表示这行没有逐字，退回行级匀速。 */
  words: { at: number; text: string }[]
  /** 当前封面的主色，用来给已唱部分上色；取不到时为空串。 */
  accent: string
}

export interface OverlayStatus {
  open: boolean
  locked: boolean
  size: number
  /** 窗口是否真在屏幕上；舞台或主窗全屏时窗口还在，只是被收起来了。 */
  visible: boolean
}

 interface OverlayApi {
  toggle(enabled?: boolean): Promise<OverlayStatus>
  getStatus(): Promise<OverlayStatus>
  setLocked(locked: boolean): Promise<boolean>
  /**
   * Where the words are, in window-local CSS px.
   *
   * Only that box counts as "on the lyrics": the window is much wider than the
   * line it draws, and a locked window must not swallow clicks aimed at the
   * transparent space around the words.
   */
  setHitArea(rect: { x: number; y: number; width: number; height: number }): Promise<boolean>
  /**
   * 工具栏那一块的矩形。
   *
   * 锁定态下只有这里会接管鼠标：歌词本身必须穿透，否则桌面上的点击被窗口吃掉，
   * 用户看到的就是「锁了没锁住」。
   */
  setToolbarArea(rect: { x: number; y: number; width: number; height: number }): Promise<boolean>
  /**
   * True while the pointer is over the lyrics.
   *
   * The main process polls the cursor - a locked window ignores the mouse, so
   * the page cannot observe hover on its own - and this drives the controls.
   */
  onHover(handler: (hovering: boolean) => void): () => void
  close(): Promise<OverlayStatus>
  /**
   * 把桌面歌词上的按钮交回播放器。
   *
   * 桌面窗自己放不了歌：它只画字，播放状态与队列都在主窗里。这条命令走的是
   * 托盘和任务栏缩略图按钮已经在用的同一条通道。
   */
  command(command: MediaCommand): Promise<boolean>
  push(state: OverlayState): Promise<boolean>
  onState(handler: (state: OverlayState) => void): () => void
  onStatus(handler: (status: OverlayStatus) => void): () => void
  /** The overlay lives in its own window; the settings page drives it from here. */
  setSize(size: number): Promise<number>
  onSize(handler: (size: number) => void): () => void
  /**
   * 舞台铺满整屏、或主窗自己进了全屏时，把桌面歌词先收起来。
   *
   * 只藏不关：退出全屏后再 `showInactive` 回来，用户不用重新打开一次。系统里
   * 别的程序全屏这一版不处理，要原生模块，见 docs/roadmap.md 的 P1-3。
   */
  setSuppressed(suppressed: boolean): Promise<OverlayStatus>
}

 interface DesktopLyricsSettings {
  size: number
  min: number
  max: number
}

/**
 * Everything the settings page can read and write.
 *
 * These live in the main process rather than in renderer storage on purpose:
 * the desktop lyric window reads the same values, and `localStorage` is
 * per-window - the settings page could not see or change what the overlay had
 * written, which is exactly the bug this shape avoids.
 *
 * There is no appearance/theme entry. Aurora has exactly one palette (a cool
 * graphite ramp whose only colour comes from the artwork) and `tokens.css`
 * already declares `color-scheme: dark`, so a theme switch would move nothing a
 * user can see. A setting that does nothing is worse than an absent one.
 */
export interface AppSettings {
  onlineLyrics: boolean
  updateInterval: UpdateInterval
  updateLastCheck: number
  desktopLyrics: DesktopLyricsSettings
  /**
   * 点关闭按钮时收进托盘（true）还是退出应用（false）。
   *
   * 这个值只有主进程能兑现（它才知道托盘图标是否真的建起来了），
   * 所以渲染层只负责把它写下去，行为在主进程的 close 处理里。
   */
  closeToTray: boolean
  /** 随系统启动。未打包的构建里主进程不会真去注册，值照样保存。 */
  launchAtLogin: boolean
  /** 放歌时拦住系统挂起（屏幕关闭仍按系统电源计划）。 */
  preventSleepWhilePlaying: boolean
  /** 下载完在资源管理器里把文件选出来。批量下完只弹一次。 */
  openAfterDownload: boolean
  /** 点一下托盘图标：切换窗口显隐，还是只把窗口叫出来。 */
  trayClick: TrayClick
  /** 锁住桌面歌词时，鼠标悬到那行字上要不要临时接管。 */
  overlayHoverControls: boolean
  /** 在线音频缓存上限（MB）；0 表示不缓存。 */
  mediaCacheLimitMb: number
}

/** 在线音频缓存目录的占用与预算。 */
export interface MediaCacheStats {
  entries: number
  bytes: number
  limitBytes: number
  directory: string
}

interface MediaCacheApi {
  stats(): Promise<MediaCacheStats>
  clear(): Promise<MediaCacheStats>
  openFolder(): Promise<void>
}

 interface SettingsApi {
  getAll(): Promise<AppSettings>
  setOnlineLyrics(enabled: boolean): Promise<AppSettings>
  setDesktopLyricsSize(size: number): Promise<AppSettings>
  setCloseToTray(enabled: boolean): Promise<AppSettings>
  setLaunchAtLogin(enabled: boolean): Promise<AppSettings>
  setPreventSleep(enabled: boolean): Promise<AppSettings>
  setOpenAfterDownload(enabled: boolean): Promise<AppSettings>
  setTrayClick(mode: TrayClick): Promise<AppSettings>
  setOverlayHoverControls(enabled: boolean): Promise<AppSettings>
  setMediaCacheLimit(megabytes: number): Promise<AppSettings>
  /** Bytes on disk for the cache and data directories; null when unmeasurable. */
  getStorage(): Promise<StorageUsage>
  /**
   * Delete the regenerable cache (cover/lyric/http caches). Never touches the
   * library index, playlists, profiles or account credentials.
   */
  clearCache(): Promise<StorageUsage>
}

// --- 网易云（第三方逆向接口）---------------------------------------------
//
// 这一层是「在线音源」的全部能力面。它与本地曲库严格分离：网易云的歌从不进入
// library store，而是由 src/netease 自己的 store 持有。所有网络与 cookie 都在
// 主进程，渲染层只拿到已经归一化的数据。

/**
 * Wallpaper Engine 背景：主进程读它自己安装目录的工程，渲染层只管挑一张。
 *
 * 三个字段是三个问题：装没装（found）、现在这张是什么（kind/title/src）、
 * 为什么要退化成没有（note）。渲染层不解析 note 之外的任何主进程语义。
 */
export interface WallpaperInfo {
  found: boolean
  kind: WallpaperKind
  title: string
  /** 能直接放进 <img>/<video>/<iframe> 的地址；场景壁纸这里是预览图。 */
  src: string | null
  note: string
  engineDir: string | null
  /** 当前壁纸的可调项，形状同 WallpaperEntry.properties。 */
  properties?: WallpaperProperty[]
}

export type WallpaperKind = 'none' | 'scene' | 'video' | 'web' | 'image'

/** 壁纸自带的可调项类型。只剩这四种是真正能改的控件，其余在解析层就被丢掉了。 */
export type WallpaperPropertyType = 'slider' | 'bool' | 'color' | 'combo' | 'textinput'

/**
 * Wallpaper Engine 工程自带的一项自定义设置（project.json 的 general.properties）。
 *
 * 值就按 WE 自己的标量形状走：slider 是数字，bool 是布尔，color 是 "r g b"
 * 三个 0..1 浮点数拼成的字符串，combo 是字符串。
 */
export interface WallpaperProperty {
  name: string
  type: WallpaperPropertyType
  /** 给人看的标签，主进程已经剥掉作者写在里面的 HTML。 */
  text: string
  value: boolean | number | string
  min?: number
  max?: number
  step?: number
  options?: { label: string; value: string }[]
  /** 不在设置页出现，但仍按固定值交给引擎（音频感应、自定义文字、帧率显示）。 */
  muted?: boolean
  /** 静音项交给引擎的值；不给就按开关关、滑杆最小值。 */
  mutedValue?: boolean | number | string
}

/** 壁纸库里的一项。URL 已经是 `aurora-wallpaper://` 地址，渲染层不碰文件系统。 */
export interface WallpaperEntry {
  id: string
  title: string
  kind: WallpaperKind
  /** 列表缩略图；没有预览的工程为 null。 */
  previewUrl: string | null
  /** 工程目录的根 URL：场景引擎把它当作包内相对路径的基准。 */
  sourceUrl: string
  /** 视频/网页/图片壁纸的入口文件；场景壁纸为 null（整包交给场景引擎）。 */
  entryUrl: string | null
  /** 场景壁纸是否以 .pkg 形式发布（没有 .pkg 时只能用预览图，见 Backdrop）。 */
  hasPackage: boolean
  /** 是否是 Wallpaper Engine 当前在桌面上用的那一张。 */
  current: boolean
  /** 这张壁纸自带的可调项；没有可调项时是空数组。旧版主进程没有这个字段。 */
  properties?: WallpaperProperty[]
}

interface WallpaperApi {
  /**
   * 当前壁纸。`force` 会绕过主进程的 30 秒扫描缓存——用户可以在播放器开着的时候
   * 去 Wallpaper Engine 里换壁纸，回到窗口时我们得看到新的那张。
   */
  info(force?: boolean): Promise<WallpaperInfo>
  /** 全部可用的工程，设置页的壁纸库用它铺格子。 */
  list(force?: boolean): Promise<WallpaperEntry[]>
  /**
   * 场景包（`scene.pkg`）的字节。
   *
   * 场景引擎是用 `fetch` 读这个文件的，而渲染层对 `aurora-wallpaper://` 的
   * `fetch` 会被拒（图片和视频没事，只有 `fetch` 不行），于是几百 MB 的场景
   * 永远挂不起来、只能显示 230px 的预览图。改由主进程读出来、经 IPC 交给引擎。
   */
  scenePkg(id: string): Promise<Uint8Array | null>
}

/** 窗口层面的动作：全屏不落盘，下次启动回到普通窗口。 */
interface WindowApi {
  /** 切换全屏，返回切换之后的状态。 */
  toggleFullscreen(): Promise<boolean>
  isFullscreen(): Promise<boolean>
}

export interface AuroraApi {
  info(): Promise<{
    version: string
    electron: string
    chrome: string
    node: string
    platform: string
    userData: string
    /**
     * 界面这一份从哪来。
     *
     * `version` 是安装包的，热更换掉的只是渲染层；两者对不上时，只有这一项能
     * 说明「眼前这份界面是哪来的」。
     */
    renderer: {
      source: 'ota' | 'bundle'
      /** 热更那份 dist 的版本；安装包自带时为空。 */
      version: string
      /** 产物指纹；安装包自带时为空。 */
      hash: string
      /** 写这份热更的时间戳（毫秒）；0 表示没有。 */
      at: number
    }
  }>
  platforms: PlatformsApi
  library: LibraryApi
  playlists: PlaylistsApi
  app: AppApi
  settings: SettingsApi
  mediaCache: MediaCacheApi
  downloads: DownloadsApi
  updates: UpdatesApi
  player: PlayerApi
  lyrics: LyricsApi
  overlay: OverlayApi
  netease: NeteaseApi
  qq: QqApi
  kugou: KugouApi
  qishui: QishuiApi
  bilibili: BilibiliApi
  party: PartyApi
  wallpaper: WallpaperApi
  maintenance: MaintenanceApi
  window: WindowApi
}

declare global {
  interface Window {
    aurora?: AuroraApi
    /**
     * Preview harness only: makes every registered platform report itself as
     * available, so the layout with platforms can be screenshotted without a main
     * process. Read at call time by each provider's `available()`; a shipping build
     * never sets it, and the preview does not set it either unless a harness
     * deliberately asserts it.
     */
    __AURORA_FAKE_BACKENDS?: boolean
  }
}

export * from './env-types/platforms'
export * from './env-types/party'

export {}