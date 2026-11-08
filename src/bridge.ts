import type { AppSettings, AuroraApi, DownloadPrefs, UpdatePrefs } from './env'
import { demoLibrary } from './features/library/demo'

/**
 * Single access point for the preload bridge.
 *
 * When the renderer runs in a plain browser (design preview, screenshots, or a
 * future web build) `window.aurora` is absent, so we fall back to an in-memory
 * implementation. That keeps the UI previewable without Electron, which matters
 * because the interface should never be verifiable only by launching the app.
 */
const native: AuroraApi | undefined = typeof window !== 'undefined' ? window.aurora : undefined

export const isNative = Boolean(native)

const demoRoots = ['C:\\Users\\PC\\Music', 'D:\\Audio\\Lossless']

const emptyIndex = () => ({
  version: 1,
  scannedAt: Date.now(),
  roots: demoRoots,
  tracks: []
})

/**
 * Session-only settings for the preview.
 *
 * Held outside the fallback object so a setter can return the new state the way
 * the native implementation does, without the caller having to re-read.
 */
let previewSettings: AppSettings = {
  onlineLyrics: false,
  updateInterval: 'manual',
  updateLastCheck: 0,
  autoInstallUpdates: false,
  desktopLyrics: { size: 34, min: 18, max: 64 },
  closeToTray: true,
  launchAtLogin: false,
  preventSleepWhilePlaying: true
}

/**
 * Update preferences for the preview.
 *
 * `autoInstallAvailable: false` is the honest answer in a browser: there is no
 * installer to run, so the settings page renders that switch disabled.
 */
let previewDownloadPrefs: DownloadPrefs = {
  dir: '',
  effectiveDir: 'C:\\Users\\PC\\Music\\Aurora',
  format: 'original',
  bitrate: 256,
  ffmpeg: false
}

let previewPrefs: UpdatePrefs = {
  interval: 'manual',
  lastCheck: 0,
  autoInstall: false,
  autoInstallAvailable: false
}

const webFallback: AuroraApi = {
  info: async () => ({
    version: '0.1.0-web',
    electron: 'n/a',
    chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'n/a',
    node: 'n/a',
    platform: 'win32',
    userData: '（浏览器预览模式，没有数据目录）'
  }),
  library: {
    getRoots: async () => demoRoots,
    // A browser preview has no file system to search.
    autoDiscover: async () => ({ added: [], roots: [] }),
    addRoots: async () => demoRoots,
    removeRoot: async () => demoRoots,
    // The preview has no filesystem; demo lyrics come from the demo dataset.
    readLyrics: async () => null,
    reveal: async () => false,
    getIndex: async () => emptyIndex(),
    scan: async () => emptyIndex(),
    cancelScan: async () => true,
    onProgress: () => () => undefined
  },
  app: {
    // 浏览器预览没有主进程，开新标签页就是「系统浏览器」。
    openExternal: async (url) => {
      window.open(url, '_blank', 'noreferrer')
      return true
    },
    // A browser tab is never minimised to a tray, so Chromium's own answer is
    // the accurate one here; the visibility hook reads `document.hidden` too.
    getVisibility: async () => ({
      visible: !document.hidden,
      minimized: false,
      hidden: document.hidden
    }),
    onVisibility: () => () => undefined,
    onResizing: () => () => undefined
  },
  playlists: {
    /*
     * The preview has no file dialog, so import hands back a synthetic m3u
     * built from the demo library - including one path that is not in the
     * library, so the "some entries were skipped" path is exercised too.
     */
    import: async () => {
      const lines = ['#EXTM3U']
      demoLibrary.slice(0, 5).forEach((track, index) => {
        lines.push(`#EXTINF:${Math.round(track.duration)},${track.artist} - ${track.title}`)
        lines.push(index === 4 ? 'C:\\Music\\还没有扫描\\missing.flac' : track.path)
      })
      return { name: '演示导入', dir: 'C:\\Users\\PC\\Music', text: `${lines.join('\r\n')}\r\n` }
    },
    export: async () => true
  },
  downloads: {
    /*
     * A browser preview has no main process, so no file can be written. A
     * failed entry that says why beats a progress bar that never moves.
     */
    enqueue: async (request) => ({
      id: 'preview-' + request.trackId,
      provider: request.provider,
      title: request.title,
      subtitle: request.artists.join('、'),
      format: request.format ?? 'original',
      state: 'failed',
      percent: 0,
      received: 0,
      total: 0,
      speed: 0,
      message: '浏览器预览模式没有下载能力',
      createdAt: Date.now()
    }),
    cancel: async () => false,
    list: async () => [],
    clear: async () => true,
    reveal: async () => false,
    openFolder: async () => false,
    getPrefs: async () => previewDownloadPrefs,
    setPrefs: async (patch) => (previewDownloadPrefs = { ...previewDownloadPrefs, ...patch }),
    pickFolder: async () => null,
    onState: () => () => undefined
  },

  updates: {
    /*
     * A browser preview has no main process, so there is nothing to check
     * against. The message says *that*, rather than reusing the packaged
     * build's "这个构建还没有配置发布仓库" - which is what a real packaging bug
     * looked like for every shipped version, and made a preview screenshot
     * indistinguishable from a broken install.
     */
    check: async () => ({
      state: 'unconfigured',
      current: '0.1.0-web',
      message: '浏览器预览模式没有主进程，因此没有更新检查'
    }),
    download: async () => false,
    open: async () => false,
    getAutoCheck: async () => false,
    setAutoCheck: async () => false,
    getPrefs: async () => previewPrefs,
    setInterval: async (interval) => (previewPrefs = { ...previewPrefs, interval }),
    setAutoInstall: async (enabled) => (previewPrefs = { ...previewPrefs, autoInstall: enabled }),
    install: async () => false,
    onStatus: () => () => undefined,
    onAvailable: () => () => undefined
  },
  settings: {
    /*
     * The preview keeps settings in memory for the session. That is enough for
     * the settings page to be reviewed - switches move, sliders drag - without
     * pretending anything was persisted.
     */
    getAll: async () => previewSettings,
    setOnlineLyrics: async (enabled) => (previewSettings = { ...previewSettings, onlineLyrics: enabled }),
    setDesktopLyricsSize: async (size) =>
      (previewSettings = {
        ...previewSettings,
        desktopLyrics: { ...previewSettings.desktopLyrics, size }
      }),
    setCloseToTray: async (enabled) => (previewSettings = { ...previewSettings, closeToTray: enabled }),
    setLaunchAtLogin: async (enabled) => (previewSettings = { ...previewSettings, launchAtLogin: enabled }),
    setPreventSleep: async (enabled) =>
      (previewSettings = { ...previewSettings, preventSleepWhilePlaying: enabled }),
    // A browser has no userData directory, so "nothing to measure" is the
    // honest answer rather than a made-up zero.
    getStorage: async () => ({
      userData: '（浏览器预览模式，没有数据目录）',
      cache: '（浏览器预览模式，没有缓存目录）',
      cacheBytes: null,
      userDataBytes: null
    }),
    clearCache: async () => ({
      userData: '（浏览器预览模式，没有数据目录）',
      cache: '（浏览器预览模式，没有缓存目录）',
      cacheBytes: null,
      userDataBytes: null
    })
  },
  maintenance: {
    // 浏览器里没有「本应用的进程」，也没有数据目录：如实回答没有可做的事，
    // 而不是编一个「已释放 0 B」让人以为清理过了。
    memory: async () => ({ freedBytes: 0, processes: 0 }),
    scan: async () => ({ parts: [], totalBytes: 0, deferredBytes: 0, cleanedBytes: 0 }),
    clean: async () => ({ parts: [], totalBytes: 0, deferredBytes: 0, cleanedBytes: 0 })
  },
  player: {
    reportState: async () => true,
    onCommand: () => () => undefined
  },
  lyrics: {
    // The preview has no network path to the main process, and the demo dataset
    // carries its own lyric, so a lookup is simply empty here.
    lookup: async () => null,
    isOnlineEnabled: async () => false,
    setOnlineEnabled: async () => false
  },
  overlay: {
    /*
     * The preview has no main process to open a second window or push state, so
     * the overlay harness is fed a sample line directly. Without this the desktop
     * lyric design would be unreviewable outside Electron, which is the one
     * window that cannot be screenshotted here.
     */
    toggle: async () => ({ open: true, locked: false, size: previewSettings.desktopLyrics.size }),
    getStatus: async () => ({ open: true, locked: false, size: previewSettings.desktopLyrics.size }),
    setLocked: async () => true,
    setHitArea: async () => true,
    onHover: () => () => undefined,
    close: async () => ({ open: true, locked: false, size: previewSettings.desktopLyrics.size }),
    push: async () => true,
    setSize: async (size) => {
      previewSettings = {
        ...previewSettings,
        desktopLyrics: { ...previewSettings.desktopLyrics, size }
      }
      return size
    },
    onSize: () => () => undefined,
    onState: (handler) => {
      handler({
        text: '我把名字写在起雾的玻璃上',
        next: '写完就擦掉 像没发生过一样',
        title: '站台',
        artist: '陈默',
        playing: true
      })
      return () => undefined
    },
    onStatus: () => () => undefined
  },
  netease: {
    /*
     * The browser preview has no main process and therefore no online source.
     * Every call answers "nothing here" rather than throwing, so the Netease
     * view renders its signed-out empty state in the harness instead of
     * becoming the one screen that can only be reviewed inside Electron.
     */
    status: async () => ({ ready: false, loggedIn: false, detail: '浏览器预览模式没有网易云后端' }),
    // A browser has no profiles and no sessions, so there is nothing to bind.
    setProfile: async () => true,
    accountFor: async () => null,
    logoutProfile: async () => true,
    search: async () => ({ songs: [], albums: [], artists: [] }),
    streamUrl: async () => ({ ok: false, reason: 'service-unavailable' }),
    lyrics: async () => null,
    album: async () => null,
    artistTopSongs: async () => [],
    artistDetail: async () => null,
    artistSongs: async () => [],
    artistAlbums: async () => [],
    songDetail: async () => [],
    qrCreate: async () => ({ key: 'preview', url: '', imageDataUrl: '' }),
    qrCheck: async () => ({ status: 'waiting' }),
    loginCellphone: async () => ({ ok: false, message: '浏览器预览模式无法登录' }),
    loginStatus: async () => null,
    logout: async () => true,
    myPlaylists: async () => [],
    albumSublist: async () => [],
    topAlbums: async () => [],
    playlistTracks: async () => [],
    dailySongs: async () => [],
    personalFm: async () => [],
    cloudSongs: async () => [],
    likeList: async () => [],
    // 浏览器里没有主进程可写，写操作如实返回「没做成」。
    like: async () => false,
    playlistCreate: async () => null,
    playlistAddTracks: async () => false,
    playlistRemoveTracks: async () => false,
    playlistRename: async () => false,
    playlistDelete: async () => false,
    getQuality: async () => 'exhigh',
    setQuality: async () => 'exhigh'
  },
  qq: {
    /*
     * Same reasoning as the Netease fallback above, with one difference that
     * matters to the layout: this object exists so the *type* is satisfied, while
     * `available()` in the platform layer reads `window.aurora.qq` - which is null
     * in a browser. The result is that the preview shows no QQ section at all, which
     * is what a build without the QQ client really looks like.
     */
    status: async () => ({ ready: false, loggedIn: false, detail: '浏览器预览模式没有 QQ 音乐后端' }),
    setProfile: async () => true,
    accountFor: async () => null,
    logoutProfile: async () => true,
    search: async () => ({ songs: [], albums: [], artists: [] }),
    streamUrl: async () => ({ ok: false, reason: 'service-unavailable' }),
    lyrics: async () => null,
    qrCreate: async () => ({ key: 'preview', imageDataUrl: '' }),
    qrCheck: async () => ({ status: 'waiting' }),
    loginStatus: async () => null,
    logout: async () => true,
    getQuality: async () => 'exhigh',
    setQuality: async () => 'exhigh',
    // 浏览器里没有账号可读，四个库方法都如实返回空列表。
    myPlaylists: async () => [],
    recommendPlaylists: async () => [],
    playlistTracks: async () => [],
    newSongs: async () => [],
    daily: async () => [],
    liked: async () => [],
    like: async () => false,
    playlistOwned: async () => [],
    playlistCreate: async () => null,
    playlistDelete: async () => false,
    playlistRename: async () => false,
    playlistTracksEdit: async () => false,
    collectedAlbums: async () => [],
    album: async () => null
  },
  kugou: {
    /*
     * 浏览器里既没有主进程，也就没有那个本地 vendor 服务。这个对象只为满足类型，
     * 而 `available()` 读 `window.aurora.kugou`（浏览器里是 null），所以预览里
     * 根本不会出现酷狗入口——这正是「没有后端的构建」该有的样子。
     */
    status: async () => ({ ready: false, loggedIn: false, detail: '浏览器预览模式没有酷狗后端' }),
    setProfile: async () => true,
    accountFor: async () => null,
    logoutProfile: async () => true,
    search: async () => ({ songs: [], albums: [], artists: [] }),
    streamUrl: async () => ({ ok: false, reason: 'service-unavailable' }),
    qrCreate: async () => ({ key: 'preview', imageDataUrl: '' }),
    qrCheck: async () => ({ status: 'waiting' }),
    loginStatus: async () => null,
    logout: async () => true,
    getQuality: async () => 'exhigh',
    setQuality: async () => 'exhigh',
    myPlaylists: async () => [],
    recommendPlaylists: async () => [],
    newSongs: async () => [],
    playlistTracks: async () => [],
    likes: async () => [],
    like: async () => false,
    album: async () => null,
    artist: async () => null,
    artistSongs: async () => [],
    artistAlbums: async () => [],
    dailyRecommend: async () => []
  },
  qishui: {
    /*
     * 浏览器里没有主进程，也就没有那个 SDK。这个对象只为满足类型；available()
     * 读 window.aurora.qishui（浏览器里是 null），预览里因此不出现汽水入口。
     */
    status: async () => ({ ready: false, loggedIn: false, detail: '浏览器预览模式没有汽水后端' }),
    setProfile: async () => true,
    search: async () => ({ songs: [] }),
    song: async () => null,
    streamUrl: async () => ({ ok: false, reason: 'service-unavailable' }),
    qrCreate: async () => ({ key: 'preview', imageDataUrl: '' }),
    qrCheck: async () => ({ status: 'waiting' }),
    loginStatus: async () => null,
    logout: async () => true,
    liked: async () => [],
    feed: async () => [],
    like: async () => false,
    playlistTracksEdit: async () => false,
    searchPlaylists: async () => [],
    myPlaylists: async () => [],
    playlistTracks: async () => [],
    artistProfile: async () => null,
    artistSongs: async () => []
  },
  wallpaper: {
    /*
     * A browser tab has no main process, so there is no Wallpaper Engine
     * library to read. Saying "not found" is the accurate answer: the settings
     * row then explains why instead of showing an empty library the user cannot
     * use, and the preview shell simply paints without a backdrop.
     */
    info: async () => ({
      found: false,
      kind: 'none',
      title: '',
      src: null,
      note: '浏览器预览模式没有主进程，读不到 Wallpaper Engine。',
      engineDir: null
    }),
    list: async () => []
  },

  /*
   * 浏览器里没有窗口可切：报告「没进全屏」比抛错诚实，
   * 设置页那一行因此在预览里也画得出来。
   */
  window: {
    toggleFullscreen: async () => false,
    isFullscreen: async () => false
  }
}

export const bridge: AuroraApi = native ?? webFallback