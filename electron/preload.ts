import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LibraryIndex, ScanProgress } from './library-scan'
import type { AppSettings, StorageUsage } from './settings'
import type { UpdateInterval, UpdatePrefs, UpdateResult } from './updates'
import type { LyricsHit, LyricsQuery } from './lyrics'
import type { OverlayState, OverlayStatus } from './lyrics-overlay'
import type { MediaCommand } from './tray'
import type { WindowVisibilityState } from './pure/scan-progress'
import type { WallpaperEntry, WallpaperInfo } from './wallpaper'
import type { JunkId, JunkScan, MemoryRelease } from './maintenance'

/**
 * The only surface the renderer gets. Everything crossing this bridge is an
 * explicit, named capability - no `ipcRenderer` handle ever reaches page code.
 *
 * The `library-scan` import is type-only, so it is erased at compile time and
 * does not pull main-process code into the preload bundle.
 */
const api = {
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
  app: {
    /** 关于页的仓库与反馈按钮；主进程只放行 GitHub 链接。 */
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url) as Promise<boolean>,
    getVisibility: () => ipcRenderer.invoke('app:visibility') as Promise<WindowVisibilityState>,
    onVisibility: (handler: (state: WindowVisibilityState) => void) => {
      const listener = (_event: IpcRendererEvent, state: WindowVisibilityState) => handler(state)
      ipcRenderer.on('app:visibility', listener)
      return () => {
        ipcRenderer.removeListener('app:visibility', listener)
      }
    }
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
      ipcRenderer.invoke('wallpaper:list', force === true) as Promise<WallpaperEntry[]>
  },

  library: {
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
    getStorage: () => ipcRenderer.invoke('settings:storage') as Promise<StorageUsage>,
    clearCache: () => ipcRenderer.invoke('settings:clearCache') as Promise<StorageUsage>
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
      ipcRenderer.invoke('maintenance:clean', ids) as Promise<JunkScan>
  },

  /**
   * 窗口层面的动作，不属于「设置」：全屏不落盘，关闭行为是设置的一部分但由主进程兑现。
   * 单独一组，是为了让渲染层一眼看出哪些调用会动到窗口本身。
   */
  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen') as Promise<boolean>,
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen') as Promise<boolean>
  },

  updates: {
    check: () => ipcRenderer.invoke('updates:check') as Promise<UpdateResult>,
    /** Opens the release page in the system browser. */
    open: (url: string) => ipcRenderer.invoke('updates:open', url) as Promise<boolean>,
    getAutoCheck: () => ipcRenderer.invoke('updates:getAutoCheck') as Promise<boolean>,
    setAutoCheck: (enabled: boolean) =>
      ipcRenderer.invoke('updates:setAutoCheck', enabled) as Promise<boolean>,
    getPrefs: () => ipcRenderer.invoke('updates:getPrefs') as Promise<UpdatePrefs>,
    setInterval: (interval: UpdateInterval) =>
      ipcRenderer.invoke('updates:setInterval', interval) as Promise<UpdatePrefs>,
    setAutoInstall: (enabled: boolean) =>
      ipcRenderer.invoke('updates:setAutoInstall', enabled) as Promise<UpdatePrefs>,
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
    push: (state: OverlayState) => ipcRenderer.invoke('overlay:push', state) as Promise<boolean>,
    /** The settings page resizes the strip; the overlay's own buttons do too. */
    setSize: (size: number) => ipcRenderer.invoke('overlay:setSize', size) as Promise<number>,
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
    /** Fired in the player window when the overlay opens, closes or locks. */
    onStatus: (handler: (status: OverlayStatus) => void) => {
      const listener = (_event: IpcRendererEvent, status: OverlayStatus) => handler(status)
      ipcRenderer.on('overlay:status', listener)
      return () => {
        ipcRenderer.removeListener('overlay:status', listener)
      }
    }
  },

  /**
   * Netease Cloud Music, through a third-party reverse-engineered API.
   *
   * Every call is a plain invoke: the main process owns the upstream client, the
   * cookie jar and the bootstrapped device credentials, so no credential and no
   * raw upstream URL ever reaches page code. Audio and artwork are proxied
   * through the `aurora-remote:` scheme for the same reason.
   */
  netease: {
    setProfile: (profileId: string) =>
      ipcRenderer.invoke('netease:setProfile', profileId) as Promise<boolean>,
    accountFor: (profileId: string) =>
      ipcRenderer.invoke('netease:accountFor', profileId),
    logoutProfile: (profileId: string) =>
      ipcRenderer.invoke('netease:logoutProfile', profileId) as Promise<boolean>,
    status: () => ipcRenderer.invoke('netease:status'),
    search: (keywords: string, type: string, limit?: number) =>
      ipcRenderer.invoke('netease:search', { keywords, type, limit }),
    streamUrl: (songId: number, quality?: string) =>
      ipcRenderer.invoke('netease:streamUrl', { songId, quality }),
    lyrics: (songId: number) => ipcRenderer.invoke('netease:lyrics', songId),
    album: (id: number) => ipcRenderer.invoke('netease:album', id),
    artistTopSongs: (id: number, limit?: number) =>
      ipcRenderer.invoke('netease:artistTopSongs', { id, limit }),
    artistDetail: (id: number) => ipcRenderer.invoke('netease:artistDetail', id),
    artistSongs: (id: number, limit?: number, offset?: number) =>
      ipcRenderer.invoke('netease:artistSongs', { id, limit, offset }),
    artistAlbums: (id: number, limit?: number, offset?: number) =>
      ipcRenderer.invoke('netease:artistAlbums', { id, limit, offset }),
    songDetail: (ids: number[]) => ipcRenderer.invoke('netease:songDetail', ids),

    qrCreate: () => ipcRenderer.invoke('netease:qrCreate'),
    qrCheck: (key: string) => ipcRenderer.invoke('netease:qrCheck', key),
    loginCellphone: (phone: string, password: string) =>
      ipcRenderer.invoke('netease:loginCellphone', { phone, password }),
    loginStatus: () => ipcRenderer.invoke('netease:loginStatus'),
    logout: () => ipcRenderer.invoke('netease:logout'),

    myPlaylists: () => ipcRenderer.invoke('netease:myPlaylists'),
    albumSublist: () => ipcRenderer.invoke('netease:albumSublist'),
    topAlbums: (limit?: number) => ipcRenderer.invoke('netease:topAlbums', limit),
    playlistTracks: (id: number) => ipcRenderer.invoke('netease:playlistTracks', id),
    dailySongs: () => ipcRenderer.invoke('netease:dailySongs'),
    cloudSongs: () => ipcRenderer.invoke('netease:cloudSongs'),
    likeList: () => ipcRenderer.invoke('netease:likeList'),
    like: (id: number, liked: boolean) => ipcRenderer.invoke('netease:like', { id, liked }),

    discover: (kind: string, limit?: number, offset?: number) =>
      ipcRenderer.invoke('netease:discover', { kind, limit, offset }),

    getQuality: () => ipcRenderer.invoke('netease:getQuality'),
    setQuality: (quality: string) => ipcRenderer.invoke('netease:setQuality', quality)
  },

  /**
   * QQ Music, through a second third-party reverse-engineered API.
   *
   * Same shape as `netease`, deliberately: the profile binding, the flat
   * stream result and the quality tier vocabulary are shared, so the renderer's
   * online-platform layer treats both platforms through one contract. What
   * differs is QQ's own business - a track is identified by `songmid`, and a
   * paywalled track answers with a *reason* rather than an error.
   *
   * Audio and cover art go through `aurora-remote:` as well: `y.gtimg.cn` sends
   * no CORS header at all, so a cover can only be shown through the main
   * process, and keeping the audio on the same path means the page never talks
   * to a QQ host directly.
   */
  qq: {
    setProfile: (profileId: string) => ipcRenderer.invoke('qq:setProfile', profileId) as Promise<boolean>,
    accountFor: (profileId: string) => ipcRenderer.invoke('qq:accountFor', profileId),
    logoutProfile: (profileId: string) =>
      ipcRenderer.invoke('qq:logoutProfile', profileId) as Promise<boolean>,

    status: () => ipcRenderer.invoke('qq:status'),
    search: (keywords: string, type: string, limit?: number) =>
      ipcRenderer.invoke('qq:search', { keywords, type, limit }),
    streamUrl: (songId: string | number, quality?: string) =>
      ipcRenderer.invoke('qq:streamUrl', { songId, quality }),
    lyrics: (songId: string | number) => ipcRenderer.invoke('qq:lyrics', songId),

    qrCreate: () => ipcRenderer.invoke('qq:qrCreate'),
    qrCheck: (key: string) => ipcRenderer.invoke('qq:qrCheck', key),
    loginStatus: () => ipcRenderer.invoke('qq:loginStatus'),
    logout: () => ipcRenderer.invoke('qq:logout'),

    getQuality: () => ipcRenderer.invoke('qq:getQuality'),
    setQuality: (quality: string) => ipcRenderer.invoke('qq:setQuality', quality),

    // The account's own catalogue. Each answers an empty list rather than an
    // error when upstream cannot be read, so the interface can stay quiet.
    myPlaylists: (limit?: number) => ipcRenderer.invoke('qq:myPlaylists', limit),
    recommendPlaylists: (limit?: number) => ipcRenderer.invoke('qq:recommendPlaylists', limit),
    playlistTracks: (id: string | number) => ipcRenderer.invoke('qq:playlistTracks', id),
    newSongs: (limit?: number) => ipcRenderer.invoke('qq:newSongs', limit),
    daily: () => ipcRenderer.invoke('qq:daily'),
    liked: () => ipcRenderer.invoke('qq:liked'),
    collectedAlbums: (limit?: number) => ipcRenderer.invoke('qq:collectedAlbums', limit),
    album: (id: number) => ipcRenderer.invoke('qq:album', id)
  },

  /*
   * 酷狗走的是本地 vendor 服务（`vendor/KuGouMusicApi`），由主进程拉起。
   * 页面这里看不到端口、进程和 token：只看到同一种「成功给地址 / 失败给原因」
   * 的契约，和另外两个平台并排。
   *
   * 歌单 id 是主进程发的数字别名——上游 `global_collection_id` 是字符串，而共享
   * 界面按正整数取歌单。
   */
  kugou: {
    setProfile: (profileId: string) => ipcRenderer.invoke('kugou:setProfile', profileId) as Promise<boolean>,
    accountFor: (profileId: string) => ipcRenderer.invoke('kugou:accountFor', profileId),
    logoutProfile: (profileId: string) =>
      ipcRenderer.invoke('kugou:logoutProfile', profileId) as Promise<boolean>,

    status: () => ipcRenderer.invoke('kugou:status'),
    search: (keywords: string, type: string, limit?: number) =>
      ipcRenderer.invoke('kugou:search', { keywords, type, limit }),
    streamUrl: (songId: string | number, quality?: string) =>
      ipcRenderer.invoke('kugou:streamUrl', { songId, quality }),

    qrCreate: () => ipcRenderer.invoke('kugou:qrCreate'),
    qrCheck: (key: string) => ipcRenderer.invoke('kugou:qrCheck', key),
    loginStatus: () => ipcRenderer.invoke('kugou:loginStatus'),
    logout: () => ipcRenderer.invoke('kugou:logout'),

    getQuality: () => ipcRenderer.invoke('kugou:getQuality'),
    setQuality: (quality: string) => ipcRenderer.invoke('kugou:setQuality', quality),

    myPlaylists: (limit?: number) => ipcRenderer.invoke('kugou:myPlaylists', limit),
    newSongs: (limit?: number) => ipcRenderer.invoke('kugou:newSongs', limit),
    playlistTracks: (id: string | number) => ipcRenderer.invoke('kugou:playlistTracks', id)
  },

  /*
   * 汽水走的是主进程里 require 的第三方 SDK（qishui-music-api），没有本地服务。
   * 页面这里看到的东西和另外三个平台一样：搜索给歌、登录给二维码、取流给地址
   * 或原因。设备 id 与会话都留在主进程的 userData 里。
   *
   * id 是主进程发的数字别名——上游是 19 位字符串，超过 JS 安全整数。
   */
  qishui: {
    setProfile: (profileId: string) =>
      ipcRenderer.invoke('qishui:setProfile', profileId) as Promise<boolean>,

    status: () => ipcRenderer.invoke('qishui:status'),
    search: (keywords: string, limit?: number) =>
      ipcRenderer.invoke('qishui:search', { keywords, limit }),
    song: (id: number) => ipcRenderer.invoke('qishui:song', id),
    streamUrl: (songId: number, quality?: string) =>
      ipcRenderer.invoke('qishui:streamUrl', { songId, quality }),

    qrCreate: () => ipcRenderer.invoke('qishui:qrCreate'),
    qrCheck: (key: string) => ipcRenderer.invoke('qishui:qrCheck', key),
    loginStatus: () => ipcRenderer.invoke('qishui:loginStatus'),
    logout: () => ipcRenderer.invoke('qishui:logout'),

    liked: (limit?: number) => ipcRenderer.invoke('qishui:liked', limit),
    searchPlaylists: (keywords: string, limit?: number) =>
      ipcRenderer.invoke('qishui:searchPlaylists', { keywords, limit }),
    myPlaylists: (limit?: number) => ipcRenderer.invoke('qishui:myPlaylists', limit),
    playlistTracks: (id: number) => ipcRenderer.invoke('qishui:playlistTracks', id),
    artistProfile: (id: number) => ipcRenderer.invoke('qishui:artistProfile', id),
    artistSongs: (artistId: number, limit?: number) =>
      ipcRenderer.invoke('qishui:artistSongs', { artistId, limit })
  }
}

contextBridge.exposeInMainWorld('aurora', api)

export type AuroraApi = typeof api
