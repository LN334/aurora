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

/** 开屏期的平台预热：只做与账号无关的冷启动，重复调用安全。 */
interface PlatformsApi {
  warmUp(ids: string[]): Promise<{ warmed: number; total: number }>
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
}

export interface UpdateInfo {
  version: string
  name: string
  notes: string
  url: string
  publishedAt: string
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
  /**
   * Download new releases in the background and install them once the player is
   * idle. On by default: the installers are unsigned, so the one guard left is
   * "never restart while something is playing".
   */
  autoInstall: boolean
  /**
   * Whether this build can actually do it.
   *
   * False in a development checkout, and false when the optional
   * `electron-updater` dependency is not part of the build. The settings page
   * disables the switch and says so instead of offering a no-op.
   */
  autoInstallAvailable: boolean
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
  setAutoInstall(enabled: boolean): Promise<UpdatePrefs>
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

/** 维护：只动本应用自己的进程与目录，不接受任何外部路径。 */
interface MaintenanceApi {
  memory(): Promise<MemoryRelease>
  scan(): Promise<JunkScan>
  clean(ids: JunkId[]): Promise<JunkScan>
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
  /** 当前封面的主色，用来给已唱部分上色；取不到时为空串。 */
  accent: string
}

export interface OverlayStatus {
  open: boolean
  locked: boolean
  size: number
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
  autoInstallUpdates: boolean
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

/** Why a track cannot play. Drives the message; never collapse these into "下架". */
export type NeteaseFailureReason =
  | 'login-required'
  | 'vip-required'
  | 'region-limited'
  | 'trial-only'
  | 'taken-down'
  | 'network'
  | 'rate-limited'
  | 'service-unavailable'
  | 'unknown'

export interface NeteaseArtist {
  id: number
  name: string
}

export interface NeteaseAlbumRef {
  id: number
  name: string
  picUrl: string | null
}

export interface NeteaseSong {
  id: number
  name: string
  artists: NeteaseArtist[]
  album: NeteaseAlbumRef
  /** Seconds. Upstream reports milliseconds. */
  duration: number
  /** Upstream `fee`: 0 free, 1 vip, 8 low-quality free, 4 paid album. */
  fee: number
}

export type NeteaseQuality = 'standard' | 'higher' | 'exhigh' | 'lossless'

export interface NeteaseStream {
  /** Upstream http(s) URL. The renderer must proxy it, not fetch it. */
  url: string
  /** kbps */
  br: number
  level: NeteaseQuality | 'hires'
  /** Seconds of what this URL actually delivers (a trial is shorter). */
  duration: number
  trial: boolean
  trialFrom?: number
  trialTo?: number
}

export type NeteaseStreamResult =
  | { ok: true; stream: NeteaseStream }
  | { ok: false; reason: NeteaseFailureReason; message?: string }

export interface NeteasePlaylistSummary {
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  playCount: number
  creator: string
  subscribed: boolean
}

/** 发现页三个板块的标识。 */
export type NeteaseDiscoverKind = 'newsongs' | 'playlists' | 'quality'

/**
 * 发现页的一张歌单卡片。
 *
 * 与 `NeteasePlaylistSummary` 分开：那个是「我拥有的歌单」，带 `subscribed`；
 * 推荐的歌单没有归属，带的是上游一句话推荐语。
 */
export interface NeteaseDiscoverPlaylist {
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  playCount: number
  creator: string
  note: string
}

/** 发现页一个板块的结果；两个列表只会有一个非空。 */
export interface NeteaseDiscoverResult {
  kind: NeteaseDiscoverKind
  songs: NeteaseSong[]
  playlists: NeteaseDiscoverPlaylist[]
}

export interface NeteaseAccount {
  userId: number
  nickname: string
  avatarUrl: string | null
  vip: boolean
  level: number
}

export interface NeteaseSearchResult {
  songs: NeteaseSong[]
  albums: {
    id: number
    name: string
    artist: string
    picUrl: string | null
    year: number | null
    songCount: number
  }[]
  artists: { id: number; name: string; picUrl: string | null; albumCount: number }[]
}

export interface NeteaseApi {
  /**
   * Bind subsequent calls to a profile.
   *
   * An online account belongs to one profile: switching profiles switches whose
   * Netease session is in use, the same way it switches which local library is
   * open. Without this the app had a single machine-wide session, so every
   * profile saw the same online playlists while the README promised that
   * switching profiles changes your playlists.
   */
  setProfile(profileId: string): Promise<boolean>
  /** Which account a profile is signed in as, or null. Used by the profiles screen. */
  accountFor(profileId: string): Promise<NeteaseAccount | null>
  logoutProfile(profileId: string): Promise<boolean>

  /** Upstream self-check: whether the client bootstrapped and whether a cookie exists. */
  status(): Promise<{ ready: boolean; loggedIn: boolean; detail?: string }>

  search(
    keywords: string,
    type: 'song' | 'album' | 'artist',
    limit?: number
  ): Promise<NeteaseSearchResult>

  /** Resolve a playable URL. Failures are classified, not thrown. */
  streamUrl(songId: number, quality?: NeteaseQuality): Promise<NeteaseStreamResult>

  lyrics(songId: number): Promise<{ lrc: string | null; translation: string | null } | null>

  album(id: number): Promise<{
    id: number
    name: string
    artist: string
    artistId: number | null
    coverUrl: string | null
    year: number | null
    /** 专辑简介，没有就是空串。 */
    description: string
    songs: NeteaseSong[]
  } | null>

  artistTopSongs(id: number, limit?: number): Promise<NeteaseSong[]>
  artistDetail(id: number): Promise<{
    id: number
    name: string
    coverUrl: string | null
    briefDesc: string
    albumCount: number
    songCount: number
  } | null>
  artistSongs(id: number, limit?: number, offset?: number): Promise<NeteaseSong[]>
  artistAlbums(
    id: number,
    limit?: number,
    offset?: number
  ): Promise<{ id: number; name: string; coverUrl: string | null; year: number | null; songCount: number }[]>
  songDetail(ids: number[]): Promise<NeteaseSong[]>

  qrCreate(): Promise<{ key: string; url: string; imageDataUrl: string }>
  qrCheck(key: string): Promise<{
    status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
    account?: NeteaseAccount
    message?: string
  }>
  loginCellphone(
    phone: string,
    password: string
  ): Promise<{ ok: boolean; account?: NeteaseAccount; message?: string }>
  loginStatus(): Promise<NeteaseAccount | null>
  logout(): Promise<boolean>

  /**
   * 发现页的公开内容：不需要登录，匿名 cookie 就够。
   *
   * 可选：浏览器预览与部分构建没有主进程的这条通道，页面据此显示空态而不是
   * 每个操作都报一次网络错误。`bridge.ts` 的回退对象没有实现它。
   */
  discover?(
    kind: NeteaseDiscoverKind,
    limit?: number,
    offset?: number
  ): Promise<NeteaseDiscoverResult>

  /** Personal music. Empty arrays (not errors) when signed out. */
  myPlaylists(): Promise<NeteasePlaylistSummary[]>
  /** 收藏的专辑；未登录返回空数组。 */
  albumSublist(): Promise<
    { id: number; name: string; coverUrl: string | null; artistName: string; artistId: number; year: number; songCount: number }[]
  >
  /** 关注的艺人；未登录返回空数组。 */
  artistSublist(): Promise<
    { id: number; name: string; avatarUrl: string | null; albumCount: number; musicCount: number }[]
  >
  topAlbums(limit?: number, offset?: number): Promise<
    { id: number; name: string; coverUrl: string | null; artistName: string; artistId: number; year: number; songCount: number }[]
  >
  playlistTracks(id: number): Promise<NeteaseSong[]>
  /** 歌单创建者；推荐位卡片不带这个字段，详情页缺名字时补问一次。 */
  playlistCreator(id: number): Promise<string>
  dailySongs(): Promise<NeteaseSong[]>
  /** 私人漫游：一次几首没听过的，播到队尾再要下一批。 */
  personalFm(limit?: number): Promise<NeteaseSong[]>
  cloudSongs(): Promise<NeteaseSong[]>
  likeList(): Promise<NeteaseSong[]>
  /** 喜欢/取消喜欢一首歌；未登录或上游失败返回 false。 */
  like(songId: number, liked: boolean): Promise<boolean>

  /**
   * 自己建的歌单的五处写：建、加减歌、改名、删单。
   *
   * 与读接口同一套失败口径：未登录或上游拒绝时回 false/null，不抛。歌单 id 是
   * 网易云那一侧的，只有「我建的」才写得动——收藏来的别人的歌单上游也会拒。
   */
  playlistCreate(name: string): Promise<{ id: number; name: string } | null>
  playlistAddTracks(id: number, trackIds: number[]): Promise<boolean>
  playlistRemoveTracks(id: number, trackIds: number[]): Promise<boolean>
  playlistRename(id: number, name: string): Promise<boolean>
  playlistDelete(id: number): Promise<boolean>

  getQuality(): Promise<NeteaseQuality>
  setQuality(quality: NeteaseQuality): Promise<NeteaseQuality>
}

// --- QQ 音乐（第三方逆向接口）---------------------------------------------
//
// 与网易云并列的第二个在线平台，走另一套第三方接口（`@sansenjian/qq-music-api`）。
// 这里刻意与 Netease 保持同一套词汇：失败原因复用 `NeteaseFailureReason`，音质复用
// 同一个四档，播放结果同样是「成功给地址、失败给原因」而不是抛错。
//
// 两处不一样，都来自上游本身：
//   * 歌曲身份是 `songmid`（字符串），不是数字。数字 `songid` 只够查歌词，播放路由
//     用它会得到 `result=101404`（实测），所以 `id`（数字，给共享形状用）与
//     `songmid`/`mid`（字符串，播放身份）同时给出。
//   * 拒绝是**常态**：主流热歌都要会员，拿不到地址时给的是原因，不是错误。

/** 复用网易云的原因词汇；两个平台在界面上共用同一套文案。 */
export type QqFailureReason = NeteaseFailureReason

/** 与网易云同一套音质档位（`src/features/online/types.ts` 的 `QualityTier`）。 */
export type QqQuality = NeteaseQuality

export interface QqArtist {
  /** 数字 `singerID`。 */
  id: number
  /** `singerMID`。 */
  mid: string
  name: string
}

export interface QqAlbumRef {
  /** 数字 `albumID`。 */
  id: number
  /** `albumMID`，封面地址由它拼出。 */
  mid: string
  name: string
  picUrl: string | null
}

export interface QqSong {
  /** 数字 `songid`，供共享歌曲形状使用。 */
  id: number
  songId: number
  /** 播放身份；`streamUrl` 接受它或数字 id。 */
  songmid: string
  /** `songmid` 的别名，共享形状声明的 `mid` 字段。 */
  mid: string
  mediaMid: string
  name: string
  artists: QqArtist[]
  album: QqAlbumRef
  /** 秒。 */
  duration: number
  /** 目录里的付费提示（`pay.payplay`）：1 表示标价，**不是**不可播的判决。 */
  fee: number
  paid: boolean
}

/** 与 Netease 不同：QQ 的结果是扁平的，`url`/`br`/`level` 都在顶层。 */
export type QqStreamResult =
  | {
      ok: true
      url: string
      /** 请求的档位。 */
      quality: QqQuality
      /** 实际拿到的档位（可能因账号权限更低）。 */
      level: QqQuality
      /** kbps；999 是本项目表示无损的既有约定。 */
      br: number
      lossless: boolean
      trial: boolean
    }
  | { ok: false; reason: QqFailureReason; message?: string }

export interface QqSearchResult {
  songs: QqSong[]
  /**
   * 上游没有专辑搜索：这些来自「你是不是要找」的单张专辑，以及匹配到的歌手的专辑列表。
   * 所以这个数组可能很短，甚至为空——这是上游的能力边界，不是失败。
   */
  albums: {
    id: number
    name: string
    artist: string
    picUrl: string | null
    year: number | null
    songCount: number
  }[]
  /** 同上：最多是上游为这次查询匹配到的那一位歌手。 */
  artists: { id: number; name: string; picUrl: string | null; albumCount: number }[]
}

export interface QqAccount {
  /** 数字 uin。 */
  id: number
  nickname: string
  avatarUrl: string | null
  /**
   * `null` 表示「没探到」，不是「不是会员」。探测失败时主进程保留上一次的结论，
   * 免得一次网络抖动就让付费用户以为会员失效了。
   */
  vip: boolean | null
  level: number
}

export interface QqApi {
  /** 把后续调用绑定到某个档案（会话与音质偏好都是按档案存的）。 */
  setProfile(profileId: string): Promise<boolean>
  accountFor(profileId: string): Promise<QqAccount | null>
  logoutProfile(profileId: string): Promise<boolean>

  status(): Promise<{ ready: boolean; loggedIn: boolean; detail?: string }>

  search(
    keywords: string,
    type: 'song' | 'album' | 'artist',
    limit?: number
  ): Promise<QqSearchResult>

  streamUrl(songId: string | number, quality?: QqQuality): Promise<QqStreamResult>

  /** 已合并翻译的成品 LRC 文本（渲染层直接用）。 */
  lyrics(songId: string | number): Promise<string | null>

  qrCreate(): Promise<{ key: string; imageDataUrl: string }>
  qrCheck(key: string): Promise<{
    status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
    account?: QqAccount
    message?: string
  }>
  loginStatus(): Promise<QqAccount | null>
  logout(): Promise<boolean>

  getQuality(): Promise<QqQuality>
  setQuality(quality: QqQuality): Promise<QqQuality>

  /** 当前档案自己的歌单（需要登录；未登录返回空数组）。 */
  myPlaylists(limit?: number): Promise<QqPlaylistSummary[]>
  /** 公开推荐歌单（首页「歌单」横排用）；不需要账号。 */
  recommendPlaylists(limit?: number): Promise<QqPlaylistSummary[]>
  /** 一个歌单里的歌。 */
  playlistTracks(id: string | number): Promise<QqSong[]>
  /** 歌单作者。列表里不带，打开详情时补问。 */
  playlistCreator(id: number): Promise<string>
  /** 每日推荐。 */
  /** 新歌速递；不需要登录。 */
  newSongs(limit?: number): Promise<QqSong[]>
  daily(): Promise<QqSong[]>
  /** 我喜欢的音乐。 */
  liked(): Promise<QqSong[]>
  /**
   * 点/取消红心，直接写回 QQ 音乐账号。
   *
   * true 才代表上游那侧真的变成想要的态——主进程先读一次、再写、再读回来核对；
   * 没登录、不知道 mid、上游拒了、读不回来，一律 false（界面提示「没写成」）。
   */
  like(songId: number, liked: boolean): Promise<boolean>
  /**
   * 自己建的歌单（id 是 tid / dissid，与列表里那张卡的 id 一致）。
   *
   * 只列自建；「我喜欢」这类系统目录不在其中。未登录返回空数组。
   */
  playlistOwned(): Promise<{ id: number; name: string }[]>
  /** 新建歌单。未登录或上游拒了回 null。 */
  playlistCreate(name: string): Promise<{ id: number; name: string } | null>
  playlistDelete(id: number): Promise<boolean>
  playlistRename(id: number, name: string): Promise<boolean>
  /** 加（add=true）/ 删（add=false）歌。写完主进程读回核对，false 表示没成。 */
  playlistTracksEdit(id: number, songIds: number[], add: boolean): Promise<boolean>
  /** 收藏的专辑（需要登录；未登录返回空数组）。 */
  collectedAlbums(limit?: number): Promise<QqCollectedAlbum[]>
  /**
   * 一张专辑：抬头 + 曲目。
   *
   * QQ 的专辑详情只认 albummid，而页面按数字 id 寻址；主进程会从最近读过的
   * 列表里把 mid 找出来。没见过的 id 返回 null，不猜一个。
   */
  album(id: number): Promise<{ detail: QqAlbumDetail; songs: QqSong[] } | null>
}

/** 收藏专辑的一行。列表接口比详情接口短：没有简介和厂牌，但封面已经是成品地址。 */
export interface QqCollectedAlbum {
  id: number
  mid: string
  name: string
  coverUrl: string | null
  artistName: string
  artistMid: string | null
  year: number | null
  songCount: number
}

/** 一张 QQ 专辑的抬头。 */
export interface QqAlbumDetail {
  id: number
  mid: string
  name: string
  coverUrl: string | null
  artistName: string
  artistMid: string | null
  year: number | null
  trackCount: number
  description: string
}

/**
 * QQ 音乐里「我的歌单」的一行。
 *
 * 只有列表要用的字段：封面、名字、首数。歌单内容另外取——上游一次只给一份，
 * 而用户多数时候不会把它们全点开。
 */
export interface QqPlaylistSummary {
  /** `dissid`，详情接口按它取。 */
  id: number
  name: string
  /** 上游有时不给封面，所以这里可以是 null。 */
  coverUrl: string | null
  /** `song_cnt`；0 表示上游没报，不是「空歌单」。 */
  trackCount: number
  creator: string
}

// --- 酷狗音乐（第三方逆向接口 + 本地 vendor 服务）---------------------------
//
// 第三个在线平台，和 QQ 最大的不同在**部署形态**：上游不是一个能从主进程
// `require` 的 SDK，而是一个本地 Node 服务（`vendor/KuGouMusicApi`）。主进程
// 负责把它拉起来、等它就绪、随应用退出关掉；渲染层只看见「有/没有」，看不见
// 端口和进程。
//
// 沿用同一套词汇：失败原因复用 `NeteaseFailureReason`，音质复用同一个四档。
//
// 两处来自上游的事实，直接写进形状里：
//   * 播放身份不是数字。取流要 `hash` + `albumId` + `albumAudioId` 三个字符串，
//     所以 `KugouSong` 三样都带上，`id` 只是共享界面要的数字钥匙。
//   * 歌单身份是字符串 `global_collection_id`，而共享界面按正整数取歌单，所以
//     `KugouPlaylistSummary.id` 是主进程在本次会话里发的稳定数字别名。

/** 复用网易云的原因词汇；界面上三个平台共用一套文案。 */
export type KugouFailureReason = NeteaseFailureReason

/** 与网易云同一套音质档位。 */
export type KugouQuality = NeteaseQuality

export interface KugouArtist {
  id: number
  name: string
  avatar: string | null
}

export interface KugouAlbumRef {
  /** 上游是字符串（`AlbumID` / `albuminfo.id`）。 */
  id: string
  name: string
  picUrl: string | null
}

/**
 * 一首酷狗歌曲。
 *
 * 三个 hash 是三种音质：128k、320k、无损。上游对没有的档位给空串，所以这里
 * 也是空串而不是 null——"没有这一档"与"这一档不可用"在客户端是同一件事。
 */
export interface KugouSong {
  /** 数字钥匙，共享界面用它索引；真正的身份在下面几个字符串里。 */
  id: number
  /** 上游 `FileHash`（128k）。 */
  hash: string
  hqHash: string
  sqHash: string
  /** 上游 `MixSongID`，取流要的 `album_audio_id`。 */
  albumAudioId: string
  albumId: string
  name: string
  artists: KugouArtist[]
  album: KugouAlbumRef
  /** 秒。上游是毫秒（`timelen`）时客户端已经换算过。 */
  duration: number
  /** 0 免费、1 会员、4 付费专辑……与 QQ/网易云同一个词汇。 */
  fee: number
  /** 上游明确说了「要付费」时为 true。 */
  paid: boolean
}

export type KugouStreamResult =
  | {
      ok: true
      url: string
      /** 请求的档位。 */
      quality: KugouQuality
      /** 实际拿到的档位，可能低于请求。 */
      level: KugouQuality
      br: number
      lossless: boolean
      trial: boolean
    }
  | { ok: false; reason: KugouFailureReason; message?: string }

export interface KugouSearchResult {
  songs: KugouSong[]
  /** 上游只有歌曲搜索，这两个恒为空数组（形状存在是为了共享读取器）。 */
  albums: KugouAlbumRef[]
  artists: KugouArtist[]
}

export interface KugouAccount {
  id: number
  nickname: string
  avatarUrl: string | null
}

export interface KugouStatusResult {
  ready: boolean
  loggedIn: boolean
  detail?: string
}

/** 待扫的二维码。`key` 是不透明句柄，轮询用它；上游的 `qrcode` 留在主进程。 */
export interface KugouQrSession {
  key: string
  imageDataUrl: string
}

export interface KugouQrResult {
  status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
  account?: KugouAccount
  message?: string
}

/**
 * 酷狗里「歌单」的一行。
 *
 * `id` 是主进程发的数字别名（上游 `global_collection_id` 是字符串，而共享界面
 * 按正整数取歌单）。别名在本次会话里稳定，重开应用后重新取一次列表即可。
 */
/** 一张专辑的头部；曲目在 `KugouAlbumBundle.songs` 里。 */
export interface KugouAlbumDetail {
  id: number
  name: string
  artist: string
  picUrl: string | null
  year: number | null
  /** 专辑简介；上游没写就是空串。 */
  intro: string
  /** 曲目数由曲目接口的 total 补；0 表示没问到。 */
  songCount: number
}

export interface KugouAlbumBundle {
  detail: KugouAlbumDetail
  songs: KugouSong[]
}

/** 一个艺人的头部。三个数字都是上游自己报的，不是估算。 */
export interface KugouArtistDetail {
  id: number
  name: string
  picUrl: string | null
  albumCount: number
  songCount: number
  fans: number
  intro: string
}

/** 专辑列表的一行：与共享的 `OnlineAlbumRef` 同形。 */
export interface KugouAlbumEntry {
  id: number
  name: string
  artist: string
  picUrl: string | null
  year: number | null
  songCount: number
}

export interface KugouPlaylistSummary {
  id: number
  name: string
  coverUrl: string | null
  /** 上游 `count`；0 表示没报，不是「空歌单」。 */
  trackCount: number
  creator: string
}

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
export type WallpaperPropertyType = 'slider' | 'bool' | 'color' | 'combo'

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
}

/** 窗口层面的动作：全屏不落盘，下次启动回到普通窗口。 */
interface WindowApi {
  /** 切换全屏，返回切换之后的状态。 */
  toggleFullscreen(): Promise<boolean>
  isFullscreen(): Promise<boolean>
}

/**
 * 酷狗的桥。
 *
 * 与 QQ 同一套方法名，少一个（没有歌词），多出来的 `playlistTracks`/`album`/`artist`
 * 接受数字别名。`streamUrl` 的入参是数字钥匙或字符串上游 id。
 */
export interface KugouApi {
  setProfile(profileId: string): Promise<boolean>
  accountFor(profileId: string): Promise<KugouAccount | null>
  logoutProfile(profileId: string): Promise<boolean>

  status(): Promise<KugouStatusResult>
  search(keywords: string, type?: string, limit?: number): Promise<KugouSearchResult>
  /** 取播放地址。未登录、需要会员、上游拒绝都按原因作答，不抛错。 */
  streamUrl(songId: string | number, quality?: KugouQuality): Promise<KugouStreamResult>

  qrCreate(): Promise<KugouQrSession>
  qrCheck(key: string): Promise<KugouQrResult>
  loginStatus(): Promise<KugouAccount | null>
  logout(): Promise<boolean>

  getQuality(): Promise<KugouQuality>
  setQuality(quality: KugouQuality): Promise<KugouQuality>

  /** 当前档案的歌单；未登录时是公开榜单，读不到就是空数组。 */
  myPlaylists(limit?: number): Promise<KugouPlaylistSummary[]>
  /** 公开推荐歌单（首页「歌单」横排用）；不需要账号。 */
  recommendPlaylists(limit?: number): Promise<KugouPlaylistSummary[]>
  /** 新歌速递；不需要登录。 */
  newSongs(limit?: number): Promise<KugouSong[]>
  /** 一张歌单里的歌。`id` 是列表里那个数字别名。 */
  playlistTracks(id: string | number): Promise<KugouSong[]>
  /** 歌单作者；同样是数字别名。 */
  playlistCreator(id: number): Promise<string>
  /** 「我喜欢」。酷狗没有独立接口，读的就是那张云端歌单。 */
  likes(limit?: number): Promise<KugouSong[]>
  /**
   * 点红心 / 取消。酷狗这边等于把歌加进「我喜欢」歌单或从里面删掉，
   * 主进程写完会读回核对，true 才代表上游真的变了。
   */
  like(songId: number, liked: boolean): Promise<boolean>

  /** 一张专辑的头部 + 曲目；查不到时 null（不是空对象）。 */
  album(id: number): Promise<KugouAlbumBundle | null>
  /** 一个艺人的头部。 */
  artist(id: number): Promise<KugouArtistDetail | null>
  /** 艺人页「全部歌曲」，按热度排。 */
  artistSongs(id: number, limit?: number, offset?: number): Promise<KugouSong[]>
  /** 艺人页「专辑」。 */
  artistAlbums(id: number, limit?: number, offset?: number): Promise<KugouAlbumEntry[]>
  /** 每日推荐 30 首；不需要登录。 */
  dailyRecommend(): Promise<KugouSong[]>
}

// --- 汽水音乐（抖音，第三方逆向接口 + npm SDK）-------------------------------
//
// 第四个在线平台，部署形态最简单也最特别：没有本地服务，全部请求由主进程
// require('qishui-music-api') 直接发出。
//
// 两处来自上游的事实，直接写进形状里：
//   * 所有 id 都是 19 位十进制字符串，超过 JS 安全整数。共享界面按数字取 id，
//     所以主进程发数字别名（userData/qishui-refs.json 里存双向表），原始字符串放 mid。
//   * 音质分四档但与另外三家不同名（standard/high/lossless/hires），单独定义。

export type QishuiQuality = 'standard' | 'high' | 'lossless' | 'hires'

/** 复用网易云的原因词汇；界面上四个平台共用一套文案。 */
type QishuiFailureReason = NeteaseFailureReason

interface QishuiArtist {
  id: number
  name: string
}

interface QishuiAlbumRef {
  id: number
  name: string
  picUrl: string | null
}

export interface QishuiSong {
  /** 数字别名，共享界面用它索引；真正的身份在 mid 里。 */
  id: number
  /** 上游原始 id，19 位十进制字符串。 */
  mid: string
  name: string
  artists: QishuiArtist[]
  album: QishuiAlbumRef
  /** 秒。 */
  duration: number
  coverUrl: string | null
}

type QishuiStreamResult =
  | { ok: true; url: string; level: QishuiQuality; br: number; trial: boolean }
  | { ok: false; reason: QishuiFailureReason; message?: string }

interface QishuiSearchResult {
  songs: QishuiSong[]
}

interface QishuiAccount {
  id: string
  nickname: string
  avatarUrl: string | null
}

interface QishuiStatusResult {
  ready: boolean
  loggedIn: boolean
  detail?: string
}

/** 待扫的二维码。key 是不透明句柄，轮询用它。 */
interface QishuiQrSession {
  key: string
  imageDataUrl: string
}

interface QishuiQrResult {
  status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
  account?: QishuiAccount
  message?: string
}

interface QishuiPlaylistSummary {
  id: number
  name: string
  coverUrl: string | null
  /** 上游 track_count；0 表示没报，不是「空歌单」。 */
  trackCount: number
  creator: string
  /** 歌单作者的账号 id；空串表示上游没报。渲染侧拿它和自己的账号 id 比，分自建与收藏。 */
  ownerId: string
}

interface QishuiArtistProfile {
  id: number
  name: string
  coverUrl: string | null
  description: string
  /** 上游 count_tracks；0 表示没报。 */
  trackCount: number
}

/**
 * 汽水的桥。
 *
 * 与另外三个平台同一套词汇，但有两点不同：搜索只有歌曲（上游没有专辑/艺人
 * 搜索），专辑页因此不做；播放地址只有一种真档位（standard），别的高档位
 * 要会员，失败会按 vip-required 答回来。
 */
export interface QishuiApi {
  setProfile(profileId: string): Promise<boolean>
  status(): Promise<QishuiStatusResult>
  search(keywords: string, limit?: number): Promise<QishuiSearchResult>
  song(id: number): Promise<QishuiSong | null>
  /** 取播放地址。未登录、需要会员、上游拒绝都按原因作答，不抛错。 */
  streamUrl(songId: number, quality?: QishuiQuality): Promise<QishuiStreamResult>

  qrCreate(): Promise<QishuiQrSession>
  qrCheck(key: string): Promise<QishuiQrResult>
  loginStatus(): Promise<QishuiAccount | null>
  logout(): Promise<boolean>

  /** 「我喜欢的」。未登录时上游答 auth-required，这里给空数组。 */
  liked(limit?: number): Promise<QishuiSong[]>
  /**
   * 推荐流。与另外几个个性化接口不同，`feed` 游客也能读到——一天一批、一次
   * 最多 30 首，是汽水唯一能进「漫游」的入口。
   */
  feed(limit?: number): Promise<QishuiSong[]>
  /** 收藏／取消收藏。写回平台账号，未登录或上游拒绝回 false。 */
  like(songId: number, liked: boolean): Promise<boolean>
  /**
   * 往自己的歌单里加歌／移出歌。
   *
   * 汽水上游只给了这两个动作，不能新建、改名、删单——所以另外三支没有。
   */
  playlistTracksEdit(playlistId: number, songIds: number[], add: boolean): Promise<boolean>
  /** 公开歌单搜索；首页推荐位用它拿「汽水推荐了什么」，不需要登录。 */
  searchPlaylists(keywords: string, limit?: number): Promise<QishuiPlaylistSummary[]>
  myPlaylists(limit?: number): Promise<QishuiPlaylistSummary[]>
  playlistCreator(id: number): Promise<string>
  /**
   * 这张歌单是不是当前账号自己建的。
   *
   * 列表只给数字 `owner_id`，登录态给的是加密 id，两个域对不上；能比的只有详情里的
   * `relation_info.owner.id`。拿不到任一侧时回 null（分不出来），不要猜。
   */
  playlistOwned(id: number): Promise<boolean | null>
  playlistTracks(id: number): Promise<QishuiSong[]>
  artistProfile(id: number): Promise<QishuiArtistProfile | null>
  artistSongs(artistId: number, limit?: number): Promise<QishuiSong[]>
}

export interface AuroraApi {
  info(): Promise<{
    version: string
    electron: string
    chrome: string
    node: string
    platform: string
    userData: string
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

export {}