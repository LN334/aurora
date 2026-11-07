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

 interface LibraryApi {
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
 * The three `install*` states only ever appear when the user has explicitly
 * turned on automatic installation; the default flow still stops at
 * `available` and hands the download to their browser.
 */
export type UpdateResult =
  | { state: 'current'; current: string; checkedAt: number }
  | { state: 'available'; current: string; checkedAt: number; info: UpdateInfo }
  | { state: 'unconfigured'; current: string; message: string }
  | { state: 'error'; current: string; checkedAt: number; message: string }
  | { state: 'downloading'; current: string; info: UpdateInfo; percent: number; transferred: number; total: number }
  | { state: 'ready'; current: string; info: UpdateInfo }
  | { state: 'installing'; current: string; info: UpdateInfo }

/** How often the background check runs. `manual` means "only when I ask". */
export type UpdateInterval = 'manual' | 'daily' | 'weekly'

export interface UpdatePrefs {
  interval: UpdateInterval
  /** Epoch ms of the last completed check, 0 when it has never run. */
  lastCheck: number
  /**
   * Download and install without asking. Off by default: the installers are
   * unsigned, so this replaces the SmartScreen step with nothing.
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

 interface UpdatesApi {
  check(): Promise<UpdateResult>
  open(url: string): Promise<boolean>
  getAutoCheck(): Promise<boolean>
  setAutoCheck(enabled: boolean): Promise<boolean>
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
export interface MaintenanceApi {
  memory(): Promise<MemoryRelease>
  scan(): Promise<JunkScan>
  clean(ids: JunkId[]): Promise<JunkScan>
}

export type MediaCommand = 'toggle' | 'next' | 'prev'

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
}

 interface SettingsApi {
  getAll(): Promise<AppSettings>
  setOnlineLyrics(enabled: boolean): Promise<AppSettings>
  setDesktopLyricsSize(size: number): Promise<AppSettings>
  setCloseToTray(enabled: boolean): Promise<AppSettings>
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
  playlistTracks(id: number): Promise<NeteaseSong[]>
  dailySongs(): Promise<NeteaseSong[]>
  cloudSongs(): Promise<NeteaseSong[]>
  likeList(): Promise<NeteaseSong[]>
  /** 喜欢/取消喜欢一首歌；未登录或上游失败返回 false。 */
  like(songId: number, liked: boolean): Promise<boolean>

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
  /** 一个歌单里的歌。 */
  playlistTracks(id: string | number): Promise<QqSong[]>
  /** 每日推荐。 */
  daily(): Promise<QqSong[]>
  /** 我喜欢的音乐。 */
  liked(): Promise<QqSong[]>
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

/** 壁纸自带的可调项类型。只剩这五种是真正能改的控件，其余在解析层就被丢掉了。 */
export type WallpaperPropertyType = 'slider' | 'bool' | 'color' | 'textinput' | 'combo'

/**
 * Wallpaper Engine 工程自带的一项自定义设置（project.json 的 general.properties）。
 *
 * 值就按 WE 自己的标量形状走：slider 是数字，bool 是布尔，color 是 "r g b"
 * 三个 0..1 浮点数拼成的字符串，textinput/combo 是字符串。
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

export interface WallpaperApi {
  /**
   * 当前壁纸。`force` 会绕过主进程的 30 秒扫描缓存——用户可以在播放器开着的时候
   * 去 Wallpaper Engine 里换壁纸，回到窗口时我们得看到新的那张。
   */
  info(force?: boolean): Promise<WallpaperInfo>
  /** 全部可用的工程，设置页的壁纸库用它铺格子。 */
  list(force?: boolean): Promise<WallpaperEntry[]>
}

/** 窗口层面的动作：全屏不落盘，下次启动回到普通窗口。 */
export interface WindowApi {
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
  }>
  library: LibraryApi
  playlists: PlaylistsApi
  app: AppApi
  settings: SettingsApi
  updates: UpdatesApi
  player: PlayerApi
  lyrics: LyricsApi
  overlay: OverlayApi
  netease: NeteaseApi
  qq: QqApi
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
