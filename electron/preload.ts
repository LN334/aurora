import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LibraryIndex, ScanProgress } from './library-scan'
import type { AppSettings, StorageUsage } from './settings'
import type { MediaCacheStats } from './media-cache'
import type { DownloadFormat, DownloadPrefs, DownloadRequest, DownloadView } from './downloads'
import type { UpdateInterval, UpdatePrefs, UpdateResult } from './updates'
import type { LyricsHit, LyricsQuery } from './lyrics'
import type { OverlayState, OverlayStatus } from './lyrics-overlay'
import type { MediaCommand } from './tray'
import type { WindowVisibilityState } from './pure/scan-progress'
import type { WallpaperEntry, WallpaperInfo } from './wallpaper'
import type { JunkId, JunkScan, MemoryRelease } from './maintenance'
import type { BackupExportResult, BackupRestoreResult } from './backup'


/**
 * The only surface the renderer gets. Everything crossing this bridge is an
 * explicit, named capability - no `ipcRenderer` handle ever reaches page code.
 *
 * The `library-scan` import is type-only, so it is erased at compile time and
 * does not pull main-process code into the preload bundle.
 */
/**
 * 跨平台调用的原始入口，以及旧方法在搬家期间的适配层。
 *
 * 新形状是 `{ ok, value }` 或 `{ ok: false, error }`：失败带着 code 回来，页面
 * 分得清「这家没这个能力」和「这家这次没取到」。旧方法 `netease.search(...)`
 * 这类暂时保留，内部走同一条通道、把失败折成空结果——现有页面不改也能跑；
 * 改到哪一处，那里就开始看得见失败了。
 */
type ProviderAnswer =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } }

const callProvider = (provider: string, capability: string, args: unknown): Promise<ProviderAnswer> =>
  ipcRenderer.invoke('provider:call', { provider, capability, args }) as Promise<ProviderAnswer>

const api = {
  /** 统一入口：`provider.call('netease', 'search', { keywords: '钻石' })`。 */
  provider: {
    call: callProvider,
    /*
     * 这份名单必须是字面量，不能从 pure 模块 import：preload 跑在沙箱里，只认
     * electron/events 这类内置模块，require 一个本地文件会让整个 preload 崩掉
     * ——崩掉的后果是 window.aurora 整个不存在，页面一句解释都没有。
     *
     * 主进程侧的白名单才是真源（electron/pure/provider-call.ts）。这两份写歪了
     * 不会静默：多出的一家由主进程回 unsupported-provider，少掉的一家渲染层
     * 调不到。tests/provider-call.test.ts 还盯着这两处是否同步。
     */
    ids: ['netease', 'qq', 'kugou', 'qishui', 'bilibili']
  },

  info: () => ipcRenderer.invoke('app:info') as Promise<{
    version: string
    electron: string
    chrome: string
    node: string
    platform: string
    userData: string
  }>,

  /**
   * Whether the player window is on screen, owned by the main process.
   *
   * Not derivable in the renderer: `document.hidden` can be stale in Electron
   * (a window hidden to the tray may still report itself visible), and this app
   * runs with `backgroundThrottling: false`, so nothing else will throttle the
   * page for us.
   */
  /**
   * 开屏期的平台预热。
   *
   * 只管与账号无关的冷启动（酷狗拉本地服务、网易云做设备握手）：登录态仍由各
   * 平台自己的接口去问。这些初始化都是单飞幂等的，重复调用命中已热的缓存。
   */
  platforms: {
    warmUp: (ids: string[]) =>
      ipcRenderer.invoke('platforms:warmUp', ids) as Promise<{ warmed: number; total: number }>,
    signedIn: () =>
      ipcRenderer.invoke('platforms:signedIn') as Promise<Record<string, boolean>>,
    /** 四家后端的当前状态，外加一句能直接显示给人看的摘要。 */
    status: () =>
      ipcRenderer.invoke('platforms:status') as Promise<{
        list: Array<{
          id: 'netease' | 'qq' | 'kugou' | 'qishui'
          state: 'idle' | 'starting' | 'ready' | 'error' | 'offline'
          detail: string
          loggedIn: boolean | null
          at: number
        }>
        summary: string
      }>,
    /** 让某一家重新拉起。立即返回，结果从 onStatus 回来。 */
    retry: (id: string) =>
      ipcRenderer.invoke('platforms:retry', id) as Promise<{ ok: boolean; reason?: string }>,
    /** 订阅状态变化；返回取消订阅的函数。 */
    onStatus: (
      handler: (payload: {
        list: Array<{
          id: 'netease' | 'qq' | 'kugou' | 'qishui'
          state: 'idle' | 'starting' | 'ready' | 'error' | 'offline'
          detail: string
          loggedIn: boolean | null
          at: number
        }>
        summary: string
      }) => void
    ) => {
      const listener = (_event: unknown, payload: Parameters<typeof handler>[0]): void => handler(payload)
      ipcRenderer.on('platforms:changed', listener)
      return (): void => {
        ipcRenderer.removeListener('platforms:changed', listener)
      }
    }
  },

  app: {
    /** 关于页的仓库与反馈按钮；主进程只放行 GitHub 链接。 */
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url) as Promise<boolean>,
    /** 写系统剪贴板；渲染层的 clipboard API 在自定义协议下用不了。 */
    copy: (text: string) => ipcRenderer.invoke('app:copy', text) as Promise<boolean>,
    /** 读系统剪贴板；页面里的 navigator.clipboard 在这个协议下用不了。 */
    readClipboard: () => ipcRenderer.invoke('app:readClipboard') as Promise<string>,
    gpuStatus: () =>
      ipcRenderer.invoke('app:gpuStatus') as Promise<{ features: Record<string, string>; summary: string }>,
    /** 各进程内存，已按 Chromium 进程类型归好；`line` 是可以直接显示的一句。 */
    metrics: () =>
      ipcRenderer.invoke('app:metrics') as Promise<{
        summary: {
          totalMb: number
          byType: Array<{ type: string; mb: number; processes: number }>
          processes: number
        }
        line: string
        parts: string
      }>,
    /** 重启应用：导入备份之后要把新数据重新加载一遍。 */
    relaunch: () => ipcRenderer.invoke('app:relaunch') as Promise<void>,
    /** 把诊断日志导成文件；取消保存时是空串。 */
    exportLogs: () => ipcRenderer.invoke('app:exportLogs') as Promise<string>,
    /** 上一次异常退出的记录；正常退出或已经提示过是 null。 */
    crashReport: () => ipcRenderer.invoke('app:crashReport') as Promise<{ at: string; summary: string } | null>,
    getVisibility: () => ipcRenderer.invoke('app:visibility') as Promise<WindowVisibilityState>,
    onVisibility: (handler: (state: WindowVisibilityState) => void) => {
      const listener = (_event: IpcRendererEvent, state: WindowVisibilityState) => handler(state)
      ipcRenderer.on('app:visibility', listener)
      return () => {
        ipcRenderer.removeListener('app:visibility', listener)
      }
    },
    /**
     * 窗口正在被拖着改大小。
     *
     * 拖动期间界面里的毛玻璃要按新尺寸重新采样背景，那几帧慢到会把旧布局
     * 留在屏幕上，看着就是「容器大小错位、闪一下才好」。渲染进程据此临时
     * 关掉模糊，松手后再开。
     */
    onResizing: (handler: (resizing: boolean) => void) => {
      const listener = (_event: IpcRendererEvent, resizing: boolean) => handler(resizing === true)
      ipcRenderer.on('win:resizing', listener)
      return () => {
        ipcRenderer.removeListener('win:resizing', listener)
      }
    },
    /**
     * 应用图标：现在是什么、换一张、退回自带那张。
     *
     * 换图标要开系统文件对话框、要写 userData、要改快捷方式，都得在主进程做。
     * 渲染层只拿一个 data URL 预览。
     */
    getIcon: () =>
      ipcRenderer.invoke('app:icon:get') as Promise<{ custom: boolean; dataUrl: string }>,
    chooseIcon: () =>
      ipcRenderer.invoke('app:icon:choose') as Promise<{
        ok: boolean
        canceled?: boolean
        reason?: string
      }>,
    resetIcon: () => ipcRenderer.invoke('app:icon:reset') as Promise<boolean>
  },

  /**
   * Wallpaper Engine, as a backdrop source.
   *
   * The renderer never touches the file system: the main process resolves the
   * active wallpaper project and serves its files over `aurora-wallpaper:`.
   * `force` re-reads the engine config, which is what the settings page does on
   * refresh and what the backdrop does when the window regains focus. The types
   * are imported with `import type`, so the preload bundle stays free of the
   * main-process module they come from.
   */
  wallpaper: {
    info: (force?: boolean) =>
      ipcRenderer.invoke('wallpaper:info', force === true) as Promise<WallpaperInfo>,
    /** The tiled library: every project Wallpaper Engine has installed. */
    list: (force?: boolean) =>
      ipcRenderer.invoke('wallpaper:list', force === true) as Promise<WallpaperEntry[]>,
    /**
     * A scene container's bytes. The WebGL engine fetches this file, and
     * `fetch` against `aurora-wallpaper://` is refused by the renderer, so the
     * main process reads it and hands the bytes over instead.
     */
    scenePkg: (id: string) => ipcRenderer.invoke('wallpaper:scenePkg', id) as Promise<Uint8Array | null>
  },

  library: {
    /**
     * Point the library at a profile.
     *
     * Each profile keeps its own folders and its own scan index, so this runs
     * before any read of either. The reply is the new profile's folder list.
     */
    useProfile: (profileId: string | null) =>
      ipcRenderer.invoke('library:useProfile', profileId) as Promise<string[]>,
    getRoots: () => ipcRenderer.invoke('library:getRoots') as Promise<string[]>,
    autoDiscover: () =>
      ipcRenderer.invoke('library:autoDiscover') as Promise<{ added: string[]; roots: string[] }>,
    addRoots: () => ipcRenderer.invoke('library:addRoots') as Promise<string[]>,
    removeRoot: (root: string) => ipcRenderer.invoke('library:removeRoot', root) as Promise<string[]>,

    readLyrics: (trackPath: string) =>
      ipcRenderer.invoke('library:readLyrics', trackPath) as Promise<string | null>,

    reveal: (trackPath: string) =>
      ipcRenderer.invoke('library:reveal', trackPath) as Promise<boolean>,

    getIndex: () => ipcRenderer.invoke('library:getIndex') as Promise<LibraryIndex>,
    scan: () => ipcRenderer.invoke('library:scan') as Promise<LibraryIndex>,
    cancelScan: () => ipcRenderer.invoke('library:cancelScan') as Promise<boolean>,

    /** Returns an unsubscribe function; call it or the listener leaks. */
    onProgress: (handler: (progress: ScanProgress) => void) => {
      const listener = (_event: IpcRendererEvent, progress: ScanProgress) => handler(progress)
      ipcRenderer.on('library:progress', listener)
      return () => {
        ipcRenderer.removeListener('library:progress', listener)
      }
    }
  },

  playlists: {
    import: () =>
      ipcRenderer.invoke('playlists:import') as Promise<{
        name: string
        dir: string
        text: string
      } | null>,
    export: (name: string, text: string) =>
      ipcRenderer.invoke('playlists:export', { name, text }) as Promise<boolean>
  },

  /**
   * The settings page's read/write surface.
   *
   * Deliberately narrow: a settings page that could set arbitrary keys would be
   * a way for page code to write anything into the main process's config. Every
   * setter here maps to one typed field.
   */
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll') as Promise<AppSettings>,
    setOnlineLyrics: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setOnlineLyrics', enabled) as Promise<AppSettings>,
    setDesktopLyricsSize: (size: number) =>
      ipcRenderer.invoke('settings:setDesktopLyricsSize', size) as Promise<AppSettings>,
    setCloseToTray: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setCloseToTray', enabled) as Promise<AppSettings>,
    setLaunchAtLogin: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setLaunchAtLogin', enabled) as Promise<AppSettings>,
    setPreventSleep: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setPreventSleep', enabled) as Promise<AppSettings>,
    setOpenAfterDownload: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setOpenAfterDownload', enabled) as Promise<AppSettings>,
    setTrayClick: (mode: 'toggle' | 'show') =>
      ipcRenderer.invoke('settings:setTrayClick', mode) as Promise<AppSettings>,
    setOverlayHoverControls: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setOverlayHoverControls', enabled) as Promise<AppSettings>,
    getStorage: () => ipcRenderer.invoke('settings:storage') as Promise<StorageUsage>,
    clearCache: () => ipcRenderer.invoke('settings:clearCache') as Promise<StorageUsage>,
    setMediaCacheLimit: (megabytes: number) =>
      ipcRenderer.invoke('settings:setMediaCacheLimit', megabytes) as Promise<AppSettings>,
    setZoomFactor: (factor: number) =>
      ipcRenderer.invoke('settings:setZoomFactor', factor) as Promise<AppSettings>,
    setMinimizeToTray: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setMinimizeToTray', enabled) as Promise<AppSettings>,
    setOverlayNextLine: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setOverlayNextLine', enabled) as Promise<AppSettings>,
    setOverlayTranslation: (enabled: boolean) =>
      ipcRenderer.invoke('settings:setOverlayTranslation', enabled) as Promise<AppSettings>,
    setOverlayAlign: (align: 'center' | 'left') =>
      ipcRenderer.invoke('settings:setOverlayAlign', align) as Promise<AppSettings>,
    resetAll: () => ipcRenderer.invoke('settings:resetAll') as Promise<AppSettings>
  },

  /**
   * 在线音频缓存（`userData/media-cache`）。
   *
   * 单独的命名空间而不是并进 settings：这几个动作读写的是磁盘上的缓存目录，
   * 不是偏好设置，而且设置页要在「占用」变化时重新拉一次 stats。
   */
  mediaCache: {
    stats: () => ipcRenderer.invoke('mediaCache:stats') as Promise<MediaCacheStats>,
    clear: () => ipcRenderer.invoke('mediaCache:clear') as Promise<MediaCacheStats>,
    openFolder: () => ipcRenderer.invoke('mediaCache:openFolder') as Promise<void>
  },

  /**
   * 维护：释放内存、扫描与清理垃圾。
   *
   * 和设置分开，因为这三件事不是「偏好」——它们会动到磁盘与本进程的内存，
   * 而且刷新页面后不需要记住任何值。
   */
  maintenance: {
    memory: () => ipcRenderer.invoke('maintenance:memory') as Promise<MemoryRelease>,
    scan: () => ipcRenderer.invoke('maintenance:scan') as Promise<JunkScan>,
    clean: (ids: JunkId[]) =>
      ipcRenderer.invoke('maintenance:clean', ids) as Promise<JunkScan>,

    /*
     * 备份与恢复。
     *
     * 持久化键由渲染层打包交给主进程（localStorage 只有渲染层拿得到），
     * 主进程负责选路径、写文件与校验格式。
     */
    exportBackup: (storage: Record<string, string>) =>
      ipcRenderer.invoke('backup:export', storage) as Promise<BackupExportResult>,
    restoreBackup: () => ipcRenderer.invoke('backup:restore') as Promise<BackupRestoreResult>,
    openDataDir: () => ipcRenderer.invoke('maintenance:openDataDir') as Promise<void>
  },

  /**
   * 窗口层面的动作，不属于「设置」：全屏不落盘，关闭行为是设置的一部分但由主进程兑现。
   * 单独一组，是为了让渲染层一眼看出哪些调用会动到窗口本身。
   */
  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen') as Promise<boolean>,
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen') as Promise<boolean>
  },

  /**
   * 下载：队列在主进程，渲染层只发命令、听状态。
   *
   * onState 一次给整份列表而不是增量：队列最多几条，整份替换比维护增量协议
   * 少一类「漏了一条就永远对不上」的 bug。
   */
  downloads: {
    enqueue: (request: DownloadRequest) =>
      ipcRenderer.invoke('downloads:enqueue', request) as Promise<DownloadView>,
    cancel: (id: string) => ipcRenderer.invoke('downloads:cancel', id) as Promise<boolean>,
    list: () => ipcRenderer.invoke('downloads:list') as Promise<DownloadView[]>,
    clear: () => ipcRenderer.invoke('downloads:clear') as Promise<boolean>,
    reveal: (id: string) => ipcRenderer.invoke('downloads:reveal', id) as Promise<boolean>,
    openFolder: () => ipcRenderer.invoke('downloads:openFolder') as Promise<boolean>,
    getPrefs: () => ipcRenderer.invoke('downloads:getPrefs') as Promise<DownloadPrefs>,
    setPrefs: (patch: { dir?: string; format?: DownloadFormat; bitrate?: number }) =>
      ipcRenderer.invoke('downloads:setPrefs', patch) as Promise<DownloadPrefs>,
    pickFolder: () => ipcRenderer.invoke('downloads:pickFolder') as Promise<string | null>,
    onState: (handler: (views: DownloadView[]) => void) => {
      const listener = (_event: IpcRendererEvent, views: DownloadView[]) => handler(views)
      ipcRenderer.on('downloads:state', listener)
      return () => {
        ipcRenderer.removeListener('downloads:state', listener)
      }
    }
  },

  updates: {
    check: () => ipcRenderer.invoke('updates:check') as Promise<UpdateResult>,
    /** Downloads the pending release into the updater's stash. */
    download: () => ipcRenderer.invoke('updates:download') as Promise<boolean>,
    /** Opens the release page in the system browser. */
    open: (url: string) => ipcRenderer.invoke('updates:open', url) as Promise<boolean>,
    getPrefs: () => ipcRenderer.invoke('updates:getPrefs') as Promise<UpdatePrefs>,
    setInterval: (interval: UpdateInterval) =>
      ipcRenderer.invoke('updates:setInterval', interval) as Promise<UpdatePrefs>,
    install: () => ipcRenderer.invoke('updates:install') as Promise<boolean>,
    /** Fires for every transition: check result, download progress, readiness. */
    onStatus: (handler: (result: UpdateResult) => void) => {
      const listener = (_event: IpcRendererEvent, result: UpdateResult) => handler(result)
      ipcRenderer.on('updates:status', listener)
      return () => {
        ipcRenderer.removeListener('updates:status', listener)
      }
    },
    /** Fires when the daily background check finds a newer release. */
    onAvailable: (handler: (result: UpdateResult) => void) => {
      const listener = (_event: IpcRendererEvent, result: UpdateResult) => handler(result)
      ipcRenderer.on('updates:available', listener)
      return () => {
        ipcRenderer.removeListener('updates:available', listener)
      }
    }
  },

  player: {
    /** Lets the main process swap the taskbar thumbnail button between play and pause. */
    reportState: (state: { playing: boolean }) =>
      ipcRenderer.invoke('player:reportState', state) as Promise<boolean>,
    /** Transport commands from the tray menu and the thumbnail toolbar. */
    onCommand: (handler: (command: MediaCommand) => void) => {
      const listener = (_event: IpcRendererEvent, command: MediaCommand) => handler(command)
      ipcRenderer.on('media:command', listener)
      return () => {
        ipcRenderer.removeListener('media:command', listener)
      }
    }
  },

  lyrics: {
    /** Returns null when the feature is off, the track is unknown, or offline. */
    lookup: (query: LyricsQuery) =>
      ipcRenderer.invoke('lyrics:lookup', query) as Promise<LyricsHit | null>,
    isOnlineEnabled: () => ipcRenderer.invoke('lyrics:isOnlineEnabled') as Promise<boolean>,
    setOnlineEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('lyrics:setOnlineEnabled', enabled) as Promise<boolean>
  },

  /**
   * Shared by both windows: the player window opens and feeds the overlay, the
   * overlay window consumes the state and reports lock changes.
   */
  overlay: {
    toggle: (enabled?: boolean) =>
      ipcRenderer.invoke('overlay:toggle', enabled) as Promise<OverlayStatus>,
    getStatus: () => ipcRenderer.invoke('overlay:status') as Promise<OverlayStatus>,
    setLocked: (locked: boolean) =>
      ipcRenderer.invoke('overlay:setLocked', locked) as Promise<boolean>,
    /**
     * Where the words are, in window-local CSS px.
     *
     * The window is far wider than the line it draws, so the main process needs
     * the plate's own box to decide whether the pointer is "on the lyrics" or
     * just over empty transparent space.
     */
    setToolbarArea: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('overlay:setToolbarArea', rect) as Promise<boolean>,
    setHitArea: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('overlay:hit-area', rect) as Promise<boolean>,
    /** True while the pointer is over the lyrics; drives the control strip. */
    onHover: (handler: (hovering: boolean) => void) => {
      const listener = (_event: IpcRendererEvent, hovering: boolean) => handler(hovering)
      ipcRenderer.on('overlay:hover', listener)
      return () => {
        ipcRenderer.removeListener('overlay:hover', listener)
      }
    },
    close: () => ipcRenderer.invoke('overlay:close') as Promise<OverlayStatus>,
    /** 桌面歌词上的上一首/播放/下一首，转回主窗执行。 */
    command: (command: MediaCommand) =>
      ipcRenderer.invoke('overlay:command', command) as Promise<boolean>,
    push: (state: OverlayState) => ipcRenderer.invoke('overlay:push', state) as Promise<boolean>,
    /** The settings page resizes the strip; the overlay's own buttons do too. */
    setSize: (size: number) => ipcRenderer.invoke('overlay:setSize', size) as Promise<number>,
    /** 舞台或主窗全屏时让桌面歌词先藏起来，退出后再回来。 */
    setSuppressed: (suppressed: boolean) =>
      ipcRenderer.invoke('overlay:setSuppressed', suppressed) as Promise<OverlayStatus>,
    onSize: (handler: (size: number) => void) => {
      const listener = (_event: IpcRendererEvent, size: number) => handler(size)
      ipcRenderer.on('overlay:size', listener)
      return () => {
        ipcRenderer.removeListener('overlay:size', listener)
      }
    },
    /** Fired in the overlay window whenever the lyric line changes. */
    onState: (handler: (state: OverlayState) => void) => {
      const listener = (_event: IpcRendererEvent, state: OverlayState) => handler(state)
      ipcRenderer.on('overlay:state', listener)
      return () => {
        ipcRenderer.removeListener('overlay:state', listener)
      }
    },
    /** 显示偏好（下一句/译文/对齐）被设置页改动时推给歌词窗口。 */
    onDisplay: (
      handler: (display: {
        showNext: boolean
        showTranslation: boolean
        align: 'center' | 'left'
      }) => void
    ) => {
      const listener = (
        _event: IpcRendererEvent,
        display: { showNext: boolean; showTranslation: boolean; align: 'center' | 'left' }
      ): void => handler(display)
      ipcRenderer.on('overlay:display', listener)
      return () => {
        ipcRenderer.removeListener('overlay:display', listener)
      }
    },
    /** Fired in the player window when the overlay opens, closes or locks. */
    onStatus: (handler: (status: OverlayStatus) => void) => {
      const listener = (_event: IpcRendererEvent, status: OverlayStatus) => handler(status)
      ipcRenderer.on('overlay:status', listener)
      return () => {
        ipcRenderer.removeListener('overlay:status', listener)
      }
    }
  },
  /*
   * 一起听：房间开在本机进程里，同一 WiFi 下的人填地址进来。状态从主进程
   * 推回来（成员随时变），命令往下发。
   */
  party: {
    host: (name: string, port?: number) => ipcRenderer.invoke('party:host', { name, port }),
    join: (address: string, code: string, name: string, pass = '') =>
      ipcRenderer.invoke('party:join', { address, code, name, pass }),
    leave: () => ipcRenderer.invoke('party:leave'),
    pushNow: (now: unknown) => ipcRenderer.invoke('party:now', { now }),
    setQueue: (queue: unknown) => ipcRenderer.invoke('party:queue', { queue }),
    /* 房间列表：房里谁都能加、能删、能挪、能放。 */
    queueAdd: (item: unknown) => ipcRenderer.invoke('party:queueAdd', { item }),
    queueRemove: (id: string) => ipcRenderer.invoke('party:queueRemove', { id }),
    queueMove: (id: string, to: number) => ipcRenderer.invoke('party:queueMove', { id, to }),
    queuePlay: (id: string) => ipcRenderer.invoke('party:queuePlay', { id }),
    queueClear: () => ipcRenderer.invoke('party:queueClear'),
    chat: (text: string) => ipcRenderer.invoke('party:chat', { text }),
    setPublic: (address: string) => ipcRenderer.invoke('party:public', { address }),
    rename: (name: string) => ipcRenderer.invoke('party:rename', { name }),
    /* 房主的门：房间码与口令。客人调用时主进程原样返回，不会改到别人的房间。 */
    setCode: (code: string) => ipcRenderer.invoke('party:code', { code }),
    setPassword: (password: string) => ipcRenderer.invoke('party:password', { password }),
    /* 只凭房间码在同一个网络里找房；找不到回来的是 null。 */
    discover: (code: string) => ipcRenderer.invoke('party:discover', { code }),
    /* 房主把某个成员请出房间。 */
    kick: (id: string) => ipcRenderer.invoke('party:kick', { id }),
    setRelay: (relay: boolean) => ipcRenderer.invoke('party:relay', { relay }),
    sakuraTunnels: (token: string) => ipcRenderer.invoke('sakura:tunnels', { token }),
    sakuraDelete: (token: string, id: number) => ipcRenderer.invoke('sakura:delete', { token, id }),
    sakuraNodes: (token: string) => ipcRenderer.invoke('sakura:nodes', { token }),
    sakuraCreate: (input: { token: string; name: string; node: number; localPort: number; remote?: string }) =>
      ipcRenderer.invoke('sakura:create', input),
    sakuraEdit: (input: { token: string; id: number; note?: string; localPort?: number }) =>
      ipcRenderer.invoke('sakura:edit', input),
    openChat: () => ipcRenderer.invoke('party:chatWindow'),
    sakuraLogin: () => ipcRenderer.invoke('sakura:login'),
    sakuraFrpc: () => ipcRenderer.invoke('sakura:frpc'),
    sakuraInstallFrpc: () => ipcRenderer.invoke('sakura:installFrpc'),
    registerStream: (trackId: string, url: string) =>
      ipcRenderer.invoke('party:stream', { trackId, url }) as Promise<string>,
    tunnelStart: (config: { frpcPath: string; token: string; tunnelId: string }) =>
      ipcRenderer.invoke('party:tunnelStart', config),
    tunnelStop: () => ipcRenderer.invoke('party:tunnelStop'),
    tunnelState: () => ipcRenderer.invoke('party:tunnelState'),
    /* Cloudflare 快速隧道：一边听自己的公网通道，与樱花互不影响。 */
    cloudflare: {
      start: (port?: number) => ipcRenderer.invoke('party:cfStart', { port }) as Promise<unknown>,
      stop: () => ipcRenderer.invoke('party:cfStop') as Promise<unknown>,
      state: () => ipcRenderer.invoke('party:cfState') as Promise<unknown>,
      onState: (listener: (state: unknown) => void) => {
        const handler = (_event: unknown, state: unknown): void => listener(state)
        ipcRenderer.on('party:cloudflare', handler)
        return () => ipcRenderer.removeListener('party:cloudflare', handler)
      }
    },
    tunnelLogClear: () => ipcRenderer.invoke('party:tunnelLogClear'),
    onTunnel: (listener: (state: unknown) => void) => {
      const handler = (_event: unknown, state: unknown): void => listener(state)
      ipcRenderer.on('party:tunnel', handler)
      return () => ipcRenderer.removeListener('party:tunnel', handler)
    },
    state: () => ipcRenderer.invoke('party:state'),
    onState: (listener: (state: unknown) => void) => {
      const handler = (_event: unknown, state: unknown): void => listener(state)
      ipcRenderer.on('party:state', handler)
      return () => ipcRenderer.removeListener('party:state', handler)
    },
    /*
     * 邀请链接：主进程从命令行或第二次启动里捞到 `aurora://join?…` 就推过来。
     * 只递原文，解析交给渲染层那份 invite.ts。
     */
    onInvite: (listener: (link: string) => void) => {
      const handler = (_event: unknown, link: unknown): void => listener(String(link ?? ''))
      ipcRenderer.on('party:invite', handler)
      return () => ipcRenderer.removeListener('party:invite', handler)
    }
  }
}

contextBridge.exposeInMainWorld('aurora', api)

export type AuroraApi = typeof api