import type {
  AppSettings,
  AuroraApi,
  DownloadPrefs,
  OverlayStatus,
  ProviderAnswer,
  UpdatePrefs
} from './env'
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

/**
 * 浏览器预览里「一起听」的空房间。
 *
 * 没有主进程就没有房间；界面据此显示「只在桌面版可用」，而不是让按钮点下去
 * 什么都不发生。
 */
const IDLE_PARTY = {
  role: 'idle' as const,
  address: '',
  addresses: [],
  code: '',
  name: '',
  members: [],
  now: null,
  queue: [],
  publicAddress: '',
  relay: true,
  locked: false,
  connecting: false,
  refused: '',
  messages: [],
  rev: 0,
  error: ''
}

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
const basePreviewSettings: AppSettings = {
  onlineLyrics: false,
  updateInterval: 'manual',
  updateLastCheck: 0,
  desktopLyrics: { size: 34, min: 18, max: 64 },
  closeToTray: true,
  launchAtLogin: false,
  preventSleepWhilePlaying: true,
  openAfterDownload: false,
  trayClick: 'toggle',
  overlayHoverControls: true,
  overlayNextLine: true,
  overlayTranslation: true,
  overlayAlign: 'center',
  minimizeToTray: false,
  mediaCacheLimitMb: 2048,
  zoomFactor: 1
}

let previewSettings: AppSettings = {
  ...basePreviewSettings,
  desktopLyrics: { ...basePreviewSettings.desktopLyrics }
}

/**
 * Update preferences for the preview.
 *
 * 浏览器里没有安装器可跑，所以这里只回答「多久查一次」；下载与安装两个动作
 * 在预览里如实返回 false，而不是假装成功。
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
  lastCheck: 0
}

/** 预览里的桌面歌词状态：显示偏好跟着设置走，窗口永远当开着。 */
function previewOverlayStatus(): OverlayStatus {
  return {
    open: true,
    locked: false,
    size: previewSettings.desktopLyrics.size,
    visible: true,
    showNext: previewSettings.overlayNextLine,
    showTranslation: previewSettings.overlayTranslation,
    align: previewSettings.overlayAlign
  }
}

const webFallback: AuroraApi = {
  /*
   * 浏览器预览没有主进程，也就没有平台后端。这里不假装成功：调用如实带着
   * 「调不通」的 code 回来，页面才会画它真实的空态，而不是把预览里的空列表
   * 当成「这家平台没内容」。
   */
  provider: {
    ids: ['netease', 'qq', 'kugou', 'qishui', 'bilibili'],
    call: async <T,>(provider: string, capability: string): Promise<ProviderAnswer<T>> => ({
      ok: false,
      error: {
        code: 'handler-failed',
        message: `浏览器预览里没有主进程，${provider}.${capability} 调不通`
      }
    })
  },
  info: async () => ({
    version: '0.1.0-web',
    electron: 'n/a',
    chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'n/a',
    node: 'n/a',
    platform: 'win32',
    userData: '（浏览器预览模式，没有数据目录）',
    /* 浏览器预览没有主进程，也就没有热更。 */
    renderer: { source: 'bundle', version: '', hash: '', at: 0 }
  }),
  // 浏览器预览没有主进程，也就没有后端要热；如实报 0 家。
  platforms: {
    warmUp: async () => ({ warmed: 0, total: 0 }),
    // 没有主进程就没有会话文件，四家一律当没登录。
    signedIn: async () => ({}),
    /* 浏览器里没有后端，状态表是空的；界面拿到空表就不显示那一块。 */
    status: async () => ({ list: [], summary: '' }),
    retry: async () => ({ ok: false, reason: '浏览器预览没有后端' }),
    onStatus: () => () => undefined
  },
  library: {
    // One browser preview is one profile, so switching is a no-op there.
    useProfile: async () => demoRoots,
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
    /** 浏览器里没有主进程，导出会落到空实现上。 */
    exportLogs: async () => '',
    crashReport: async () => null,
    // 浏览器预览没有主进程，开新标签页就是「系统浏览器」。
    openExternal: async (url) => {
      window.open(url, '_blank', 'noreferrer')
      return true
    },
    /* 预览里是正常网页，navigator.clipboard 能读；桌面版由主进程读。 */
    gpuStatus: async () => ({ features: {}, summary: '' }),
    /* 浏览器里只有一个页面，没有多进程可拆；给空表让界面不显示这一块。 */
    metrics: async () => ({ summary: { totalMb: 0, byType: [], processes: 0 }, line: '', parts: '' }),
    readClipboard: async () => {
      try {
        return await navigator.clipboard.readText()
      } catch {
        return ''
      }
    },
    // 预览里是正常网页，navigator.clipboard 可用；失败就当没复制。
    copy: async (text) => {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        return false
      }
    },
    // 浏览器里「重启」就是刷新页面。
    relaunch: async () => {
      window.location.reload()
    },
    // A browser tab is never minimised to a tray, so Chromium's own answer is
    // the accurate one here; the visibility hook reads `document.hidden` too.
    getVisibility: async () => ({
      visible: !document.hidden,
      minimized: false,
      hidden: document.hidden
    }),
    onVisibility: () => () => undefined,
    onResizing: () => () => undefined,
    // 浏览器预览里换不了任务栏图标：如实说一声，别让按钮点了没反应。
    getIcon: async () => ({ custom: false, dataUrl: '' }),
    chooseIcon: async () => ({ ok: false, reason: '浏览器预览里换不了图标，装好应用才能用' }),
    resetIcon: async () => false
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
    getPrefs: async () => previewPrefs,
    setInterval: async (interval) => (previewPrefs = { ...previewPrefs, interval }),
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
    setOpenAfterDownload: async (enabled) =>
      (previewSettings = { ...previewSettings, openAfterDownload: enabled }),
    setTrayClick: async (mode) => (previewSettings = { ...previewSettings, trayClick: mode }),
    setOverlayHoverControls: async (enabled) =>
      (previewSettings = { ...previewSettings, overlayHoverControls: enabled }),
    setMediaCacheLimit: async (megabytes) =>
      (previewSettings = { ...previewSettings, mediaCacheLimitMb: megabytes }),
    setZoomFactor: async (factor) => (previewSettings = { ...previewSettings, zoomFactor: factor }),
    setMinimizeToTray: async (enabled) =>
      (previewSettings = { ...previewSettings, minimizeToTray: enabled }),
    setOverlayNextLine: async (enabled) =>
      (previewSettings = { ...previewSettings, overlayNextLine: enabled }),
    setOverlayTranslation: async (enabled) =>
      (previewSettings = { ...previewSettings, overlayTranslation: enabled }),
    setOverlayAlign: async (align) => (previewSettings = { ...previewSettings, overlayAlign: align }),
    /* 浏览器里没有持久化文件，重置就是把这几个字段退回内存里的初值。 */
    resetAll: async () =>
      (previewSettings = {
        ...basePreviewSettings,
        desktopLyrics: { ...basePreviewSettings.desktopLyrics }
      }),
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
  mediaCache: {
    // 浏览器里没有主进程的缓存目录；如实报空，而不是编一个占用。
    stats: async () => ({
      entries: 0,
      bytes: 0,
      limitBytes: 0,
      directory: '（浏览器预览模式，没有缓存目录）'
    }),
    clear: async () => ({
      entries: 0,
      bytes: 0,
      limitBytes: 0,
      directory: '（浏览器预览模式，没有缓存目录）'
    }),
    openFolder: async () => undefined
  },
  maintenance: {
    // 浏览器里没有「本应用的进程」，也没有数据目录：如实回答没有可做的事，
    // 而不是编一个「已释放 0 B」让人以为清理过了。
    memory: async () => ({ freedBytes: 0, processes: 0 }),
    scan: async () => ({ parts: [], totalBytes: 0, deferredBytes: 0, cleanedBytes: 0 }),
    clean: async () => ({ parts: [], totalBytes: 0, deferredBytes: 0, cleanedBytes: 0 }),
    // 备份要读写数据目录，浏览器里没有这个东西 —— 明说，不假装写成功。
    exportBackup: async () => ({ ok: false as const, reason: '浏览器里没有本地数据目录' }),
    restoreBackup: async () => ({ ok: false as const, reason: '浏览器里没有本地数据目录' }),
    openDataDir: async () => undefined
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
    toggle: async () => previewOverlayStatus(),
    getStatus: async () => previewOverlayStatus(),
    setLocked: async () => true,
    setHitArea: async () => true,
    setToolbarArea: async () => true,
    onHover: () => () => undefined,
    close: async () => previewOverlayStatus(),
    command: async () => true,
    push: async () => true,
    setSize: async (size) => {
      previewSettings = {
        ...previewSettings,
        desktopLyrics: { ...previewSettings.desktopLyrics, size }
      }
      return size
    },
    onSize: () => () => undefined,
    // 预览里没有第二个窗口可藏，状态照旧回报，调用方不用分叉。
    setSuppressed: async () => previewOverlayStatus(),
    onState: (handler) => {
      /*
       * 预览里没有播放器，也就没有真的时间轴。给一句「正在唱到一半」的假
       * 状态，是为了让 fill 那条走色在浏览器里也能被看见 —— 这正是桌面窗
       * 唯一截不到图、只能靠预览验的部分。
       */
      handler({
        text: '我把名字写在起雾的玻璃上',
        next: '写完就擦掉 像没发生过一样',
        title: '站台',
        artist: '陈默',
        playing: true,
        at: 12,
        // 拉长这一行，好让预览里的填充边界停在句子中间而不是秒满。
        to: 30,
        // 行首起步：预览页加载几秒后填充才走出一小段，边界才看得见。
        position: 12,
        duration: 214,
        /*
         * 预览的假逐字：前几个字快、中间「雾」是个长音，最后几个字又收回来。
         * 浏览器里因此能看见填充边界一停一顿 —— 行级匀速永远做不出这个。
         */
        words: [
          { at: 12, text: '我' },
          { at: 12.25, text: '把' },
          { at: 12.5, text: '名' },
          { at: 12.75, text: '字' },
          { at: 13, text: '写' },
          { at: 13.3, text: '在' },
          { at: 13.6, text: '起' },
          { at: 16.6, text: '雾' },
          { at: 17, text: '的' },
          { at: 17.4, text: '玻' },
          { at: 17.8, text: '璃' },
          { at: 18.2, text: '上' }
        ],
        // 预览没有封面取色，用 tokens.css 里那支默认 accent。
        accent: '#7d8899',
        // 预览这一句没有译文；真机上译文随状态一起从主进程推来。
        translation: null,
        nextTranslation: null
      })
      return () => undefined
    },
    onStatus: () => () => undefined,
    onDisplay: () => () => undefined
  },
  party: {
    /*
     * 一起听要主进程起 WebSocket 服务，浏览器预览里没有。这里只让类型成立：
     * 界面据此显示「只在桌面版可用」，而不是点了没反应。
     */
    host: async () => IDLE_PARTY,
    join: async () => ({ ...IDLE_PARTY, error: '浏览器预览模式没有一起听后端' }),
    leave: async () => IDLE_PARTY,
    pushNow: async () => IDLE_PARTY,
    setQueue: async () => IDLE_PARTY,
    /* 房间列表在预览里没有后端可加：原样返回空房间，界面照实提示。 */
    queueAdd: async () => IDLE_PARTY,
    queueRemove: async () => IDLE_PARTY,
    queueMove: async () => IDLE_PARTY,
    queuePlay: async () => IDLE_PARTY,
    queueClear: async () => IDLE_PARTY,
    chat: async () => ({ ...IDLE_PARTY, error: '浏览器预览模式没有一起听后端' }),
    setPublic: async () => IDLE_PARTY,
    rename: async () => IDLE_PARTY,
    setPassword: async () => IDLE_PARTY,
    setCode: async () => IDLE_PARTY,
    discover: async () => null,
    kick: async () => IDLE_PARTY,
    onInvite: () => () => {},
    registerStream: async () => '',
    setRelay: async () => IDLE_PARTY,
    sakuraTunnels: async () => ({ ok: false, message: '预览里没有隧道接口', tunnels: [], raw: '' }),
    sakuraDelete: async () => ({ ok: false, message: '预览里删不了隧道' }),
    sakuraNodes: async () => ({ ok: false, message: '预览里没有节点接口', nodes: [] }),
    sakuraCreate: async () => ({ ok: false, message: '预览里不能建隧道', id: 0 }),
    sakuraEdit: async () => ({ ok: false, message: '预览里不能改隧道' }),
    openChat: async () => false,
    sakuraLogin: async () => ({ ok: false, token: '', message: '预览里没有登录接口' }),
    sakuraFrpc: async () => ({ path: '', ok: false, message: '预览里没有 frpc' }),
    sakuraInstallFrpc: async () => ({ ok: false, message: '预览里不能下 frpc', path: '' }),
    tunnelStart: async () => ({ running: false, address: '', line: '', error: '浏览器预览没有隧道', log: [] }),
    tunnelStop: async () => ({ running: false, address: '', line: '', error: '', log: [] }),
    tunnelState: async () => ({ running: false, address: '', line: '', error: '', log: [] }),
    tunnelLogClear: async () => ({ running: false, address: '', line: '', error: '', log: [] }),
    /* Cloudflare 隧道同样要主进程起进程，浏览器预览里只让类型成立。 */
    cloudflare: {
      start: async () => ({ running: false, address: '', line: '', error: '浏览器预览没有隧道', log: [] }),
      stop: async () => ({ running: false, address: '', line: '', error: '', log: [] }),
      state: async () => ({ running: false, address: '', line: '', error: '', log: [] }),
      onState: () => () => {}
    },
    onTunnel: () => () => {},
    state: async () => IDLE_PARTY,
    onState: () => () => {}
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
    list: async () => [],
    /* 浏览器里没有 Wallpaper Engine，场景包自然也没有。 */
    scenePkg: async () => null
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