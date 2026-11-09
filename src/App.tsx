import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AccountPage } from './views/AccountPage'
import { CollectionsPage } from './views/CollectionsPage'
import { AlbumDetailPage } from './views/AlbumDetailPage'
import { ArtistPage } from './views/ArtistPage'
import { EqPanel } from './views/EqPanel'
import { DailyPage } from './views/DailyPage'
import { LikedPage } from './views/LikedPage'
import { LocalPage } from './views/LocalPage'
import { OnlinePage } from './views/OnlinePage'
import { bindDetailNavigate, refreshOnlinePlaylist } from './features/refs/navigate'
import { bindUpdateEvents } from './features/updates/store'
import { bindDownloadEvents, downloadRequestOf, useDownloads } from './features/downloads/store'
import { DownloadsDock } from './ui/DownloadsDock'
import { usePresence } from './ui/presence'
import { UpdateBar } from './ui/UpdateBar'
import { addTrackToOnlinePlaylist, removeTrackFromOnlinePlaylist, reportWrite } from './features/online/playlist-write'
import { getProvider } from './features/online/registry'
import { useAccountPlaylists } from './features/online/playlist-cards'
import { PlaylistsPage } from './views/PlaylistsPage'
import { startRoam, useRoam } from './features/player/roam-session'
import { useAvailableProviders } from './features/online/hooks'
import { PlayerBar } from './views/player-bar/PlayerBar'
import { PlaylistDetailPage } from './views/PlaylistDetailPage'
import { QueuePanel } from './views/QueuePanel'
import { Rail } from './app/Rail'
import { TitleBar } from './app/TitleBar'
import type { TrackMenuRequest } from './ui/TrackList'
import { useFlash } from './ui/flash'
import { TrackMenu } from './views/TrackMenu'
import { LikeMenu } from './views/LikeMenu'
import { ChevronLeft, Close, Expand, Plus, Queue, Refresh } from './ui/icons'
import { bridge, isNative } from './bridge'
import { demoLibrary } from './features/library/demo'
import { useLyrics, usePalette } from './features/library/hooks'
import { useRoots } from './features/library/roots'
import { loadInitialIndex, runScan } from './features/library/scan'
import { groupAlbums, useLibrary } from './features/library/store'
import { artworkFor } from './features/library/source'
import { player } from './features/player/actions'
import { driver } from './features/player/driver'
import { loadProfilePlayerPrefs, usePlayer } from './features/player/store'
import { loadProfilePlaylists, usePlaylists } from './features/playlists/store'
import { useAccounts } from './features/accounts/store'
import { useNetease } from './features/netease/store'
import { DesktopLyricsBridge } from './overlay/DesktopLyricsBridge'
import { SettingsPage } from './views/settings/SettingsPage'
import { useWindowVisibility } from './visibility'
import { Backdrop } from './features/wallpaper/Backdrop'
import { chooseEntry } from './features/wallpaper/pure'
import { useWallpaper } from './features/wallpaper/store'
import { LyricsStage } from './stage/LyricsStage'
import type { OverlayStatus } from './env'
import type { Track } from './types'
import type { Route } from './app/routing'
import {
  SHELL_TITLES,
  initialShell,
  routeToShell,
  sameShell,
  shellFromHash,
  shellToHash,
  shellToRoute,
  type ShellRoute,
  type ShellView
} from './app/shell'
import { useKeyboardShortcuts } from './app/useKeyboardShortcuts'
import { useTrackActions } from './app/useTrackActions'
import { SearchView } from './app/search/SearchView'
import { useSearch } from './app/search/store'
import { useLibraryData } from './app/useLibraryData'
import {
  MENU_TEST_MODE,
  PERF_MODE,
  SCROLL_TEST_MODE,
  SCROLL_TEST_START,
  SEARCH_TEST_LOCAL,
  SEARCH_TEST_QUERY,
  STRESS_TRACKS
} from './app/preview'
import { usePlaylistFiles } from './features/playlists/io'
import { HomePage } from './views/HomePage'
import { Sources } from './views/Sources'
import { RecentPage } from './views/RecentPage'
import { TrackView } from './views/TrackView'
import { NowPlayingPage } from './views/NowPlayingPage'
import { Refraction } from './features/glass/Refraction'

/**
 * One entry in the navigation stack. Keeping the artist drill-down in the route
 * rather than in separate state is what makes the title bar's back and forward
 * buttons real instead of decorative.
 */

/**
 * Design-harness affordance.
 *
 * The browser preview can open straight to a screen via the fragment
 * (`#artists`, `#folders`, `#songs`, `#eq`, `#stage`) so a screenshot can be
 * taken of any view without clicking through the UI. Electron ignores this
 * entirely and always starts on the album grid.
 */

/**
 * Preview-only render counter.
 *
 * The player store publishes `position` on every animation frame. Whether that
 * reaches the whole component tree or only the two leaf components that draw it
 * is the difference between sixty full-tree React renders per second and a
 * handful per song. This counter is how that gets measured rather than asserted;
 * it is skipped entirely in Electron.
 */
let appRenders = 0

/**
 * The screens that show files on this disk.
 *
 * Used to decide where the library actions (rescan, add folder) belong: they are
 * meaningful exactly here, and nowhere else. Cheap to check on every render, and
 * it keeps the condition in one place instead of growing an exception per screen.
 */

export function App() {  if (!isNative) {
    appRenders += 1
    ;(window as Window & { __auroraRenders?: number }).__auroraRenders = appRenders
  }

  // 首帧归因：commit 完成时刻。和 main.tsx 的派发时刻相减就是 React 的净耗时。
  useLayoutEffect(() => {
    console.log('[boot] react committed', Math.round(performance.now()))
  }, [])

  const [stack, setStack] = useState<ShellRoute[]>(() => [initialShell()])
  const [cursor, setCursor] = useState(0)
  /** 外壳路由：人在哪一页。左栏高亮、页头标题、地址栏都由它决定。 */
  const shell = stack[cursor] ?? { view: 'home' as ShellView }
  /** 页面组件仍然只认旧参数；这一层翻译让它们暂时不用改。 */
  const route = useMemo(() => shellToRoute(shell), [shell])
  const view = route.view

  // 侧栏收没收起是「人的习惯」，不是临时状态：下次开还按上次那样。
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('aurora.rail.collapsed') === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value
      try {
        localStorage.setItem('aurora.rail.collapsed', next ? '1' : '0')
      } catch {
        /* 存不下就算了，不值得为这个报错 */
      }
      return next
    })
  }, [])
  const [stageOpen, setStageOpen] = useState(false)
  /*
   * 舞台要留 320ms 的退场：它是 fixed 全屏且底色不透明，一帧摘掉就是硬切。
   * 打开时不需要延迟——stageOpen 立刻为真，mounted 同帧就真。
   */
  const stage = usePresence(stageOpen, 320)
  const [eqOpen, setEqOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  // 顶栏那个框自己的结果浮层。搜索不再是「跳去一个页面」。
  /** Mirrors the desktop lyric window's state, owned by the main process. */
  const [overlayStatus, setOverlayStatus] = useState<OverlayStatus>({
    open: false,
    locked: true,
    size: 34
  })
  /** Transient result message for import/export, dismissed on navigation. */
  /*
   * 顶部提示放在共享 store 里：列表行里的喜欢动作也要能说一句「没改成」。
   * 名字仍叫 flash/setFlash，App 里原来的调用点不用改。
   */
  const flash = useFlash((state) => state.message)
  const setFlash = useFlash((state) => state.show)
  /** The open per-track actions menu, if any. */
  const [trackMenu, setTrackMenu] = useState<TrackMenuRequest | null>(null)
  /*
   * 菜单的退场。
   *
   * 菜单项的动作用户一按就该发生（切歌、加入队列不能等），所以这里只推迟
   * 「卸载」这一件事：先挂 170ms 的 is-closing 让菜单缩回去，再真的把状态置空。
   * 否则点开菜单再点外面，菜单是一帧被摘掉的，看起来像被掐断。
   */
  const [menuClosing, setMenuClosing] = useState(false)
  const menuTimer = useRef<number | null>(null)
  const openTrackMenu = useCallback((request: TrackMenuRequest) => {
    if (menuTimer.current !== null) {
      window.clearTimeout(menuTimer.current)
      menuTimer.current = null
    }
    setMenuClosing(false)
    setTrackMenu(request)
  }, [])
  const closeTrackMenu = useCallback(() => {
    if (menuTimer.current !== null) return
    setMenuClosing(true)
    menuTimer.current = window.setTimeout(() => {
      menuTimer.current = null
      setMenuClosing(false)
      setTrackMenu(null)
    }, 170)
  }, [])
  useEffect(
    () => () => {
      if (menuTimer.current !== null) window.clearTimeout(menuTimer.current)
    },
    []
  )

  /*
   * 歌单只活在平台账号里：菜单里的「加入歌单」列的就是各账号能被写进去的单子。
   * 本机不再存歌单，所以这里只看平台，且只收明确是自建的那些（收藏来的单子
   * 上游不让改）。
   */
  const accountPlaylists = useAccountPlaylists()
  const writablePlaylists = useMemo(
    () =>
      accountPlaylists.cards
        .filter(
          (card) =>
            card.ownership === 'mine' && Boolean(getProvider(card.providerId)?.playlists?.addTracks)
        )
        .map((card) => ({ key: card.key, name: card.name, providerLabel: card.providerLabel })),
    [accountPlaylists.cards]
  )

  /* 旧 `Route`（legacy 地址）还认本机歌单，新导航已经不给入口了。 */
  const legacyPlaylists = usePlaylists((s) => s.playlists)

  const accounts = useAccounts((s) => s.accounts)
  const activeAccountId = useAccounts((s) => s.activeId)
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null

  const { roots, add, remove, busy } = useRoots(activeAccountId)
  const tracks = useLibrary((s) => s.tracks)
  const setTracks = useLibrary((s) => s.setTracks)
  const ready = useLibrary((s) => s.ready)
  const scanning = useLibrary((s) => s.scanning)
  const progress = useLibrary((s) => s.progress)
  const currentScan = useLibrary((s) => s.currentScan)
  const scanError = useLibrary((s) => s.error)

  const track = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
  const playing = usePlayer((s) => s.playing)
  const loading = usePlayer((s) => s.loading)
  /*
   * `position` is deliberately absent here.
   *
   * It changes on every animation frame. Subscribing at the app root re-rendered
   * the entire tree sixty times a second - measured at 403 renders in 6.3s with
   * the preview counter. The two leaf components that draw the playhead
   * subscribe themselves instead (components/PlayerBar, stage/LyricsStage).
   */
  const duration = usePlayer((s) => s.duration)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  // 队列按钮上的数字：没有它，那个图标看不出是队列。
  const queueLength = usePlayer((s) => s.queue.length)
  const eqEnabled = usePlayer((s) => s.eqEnabled)
  const eqGains = usePlayer((s) => s.eqGains)

  const palette = usePalette(track)
  const {
    lyrics,
    onlineEnabled: lyricsOnline,
    setOnline: setLyricsOnline
  } = useLyrics(track)
  const backdrop = artworkFor(track)
  const windowVisibility = useWindowVisibility()

  /*
   * The wallpaper and the artwork scrim are two different backdrops. When a
   * Wallpaper Engine wallpaper is painting, the artwork one would sit on top of it
   * and hide it, so the CSS hides one while the other is on (`.shell.has-wallpaper`).
   */
  const wallpaperEnabled = useWallpaper((s) => s.enabled)
  const wallpaperSelection = useWallpaper((s) => s.selection)
  const wallpaperInfo = useWallpaper((s) => s.info)
  const wallpaperList = useWallpaper((s) => s.list)
  const wallpaperStrength = useWallpaper((s) => s.strength)
  const refreshWallpaper = useWallpaper((s) => s.refresh)
  const wallpaperEntry = chooseEntry({
    enabled: wallpaperEnabled,
    selection: wallpaperSelection,
    info: wallpaperInfo,
    list: wallpaperList
  })

  /*
   * Wallpaper Engine 的壁纸可能在播放器开着的时候被换掉，所以窗口重新获得焦点
   * 时重读一次。这里走主进程的 30 秒扫描缓存，而不是强制全扫：强制一次是 240ms
   * 以上的同步 I/O 加 6 次 reg.exe，全压在主线程上；人切壁纸再切回来的间隔通常
   * 只有几秒，缓存里就是同一份数据。真的换了、缓存也过期了自然会重扫；要立刻
   * 看到新壁纸，设置页的「重新读取」是强制刷新。
   */
  useEffect(() => {
    if (!wallpaperEnabled) return
    refreshWallpaper()
    const onFocus = () => refreshWallpaper()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [wallpaperEnabled, refreshWallpaper])

  /**
   * 外壳导航。地址不同才入栈——同一个页面重复点不该长出历史。
   *
   * 栈里存的是外壳路由（人在哪一页），页面组件要的参数由 shellToRoute 现算。
   * 这样「返回」回到的是上一页，而不是上一次取的那份数据。
   */
  const goShell = useCallback(
    (next: ShellRoute) => {
      const current = stack[cursor]
      if (current && sameShell(current, next)) return
      const trimmed = stack.slice(0, cursor + 1)
      setStack([...trimmed, next])
      setCursor(trimmed.length)
      setFlash(null)
    },
    [stack, cursor]
  )

  /**
   * 漫游：要一趟、立刻放、进播放页。
   *
   * 三件事必须一起发生才算「点了漫游」。只放歌不跳页，人还停在歌单上，会以为
   * 没生效；只跳页不放歌，进去是一片空的播放页。所以收成一个动作，左栏与 R 键
   * 共用这一个入口。
   */
  /*
   * 人此刻停在哪一页。漫游是异步的，要几秒才回来，得知道这几秒里人走了没有。
   */
  const hereRef = useRef<ShellRoute | null>(null)
  useEffect(() => {
    hereRef.current = stack[cursor] ?? null
  }, [stack, cursor])

  const roamNow = useCallback((seed?: Track) => {
    const from = hereRef.current
    void startRoam(seed).then((ok) => {
      if (!ok) {
        // 点了没反应比报错更糟：要不到时把原因说出来。
        setFlash(useRoam.getState().error || '这一趟没要到歌')
        return
      }
      /*
       * 只有人还停在原地才把人带进播放页。要是这几秒里已经点去别处了，
       * 再跳一次就是把正在看的东西顶掉——只把队列换掉，不动页面。
       */
      if (hereRef.current === from) goShell({ view: 'nowplaying' })
    })
  }, [goShell])

  /** 页面组件仍按旧 `Route` 说话；这里翻译成外壳路由。 */
  const navigate = useCallback((next: Route) => goShell(routeToShell(next)), [goShell])

  // 歌曲行里点专辑 / 艺人要能跳页，但行不该知道外壳怎么导航，所以把导航交出去一次。
  useEffect(() => {
    bindDetailNavigate(goShell)
  }, [goShell])

  // 更新状态由主进程推来（启动那次静默检查、下载进度、下载完成），这里把通道接上。
  useEffect(() => {
    bindUpdateEvents()
  }, [])

  // 下载列表同样归主进程：面板关掉了任务也得继续跑。
  useEffect(() => {
    bindDownloadEvents()
  }, [])

  /*
   * 地址栏跟着走。
   *
   * 用 replaceState 而不是 pushState：历史栈由上面那个 stack 管，浏览器的历史
   * 再记一份会出现「点一次后退走两页」。刷新与分享仍然准确，因为地址就是当前页。
   */
  useEffect(() => {
    const hash = '#' + shellToHash(shell)
    if (window.location.hash !== hash) {
      window.history.replaceState(null, '', hash)
    }
    /*
     * 换页回到顶部。
     *
     * 不这么做的话，从一张五百多行的歌单点进专辑，新页会停在上一页的滚动位置——
     * 看上去像「页面从中间开始」，页头直接看不见。
     */
    document.querySelector('.main__body')?.scrollTo({ top: 0 })
  }, [shell])

  /*
   * 换页淡入只在「真的换了一页」时播，启动那次不播。
   *
   * 动画本身在 app.css 里，由 .is-enter 触发：首帧没有这个类，正文一上来就是
   * 可见的。类用 DOM 直接加而不是走 state，是因为 key 已经把整块内容重挂过，
   * 这里只需要让浏览器重算一次动画；再引一个 state 只会多一次渲染。
   */
  const lastRoute = useRef<string | null>(null)
  useEffect(() => {
    const key = shell.view + ':' + (shell.id ?? '')
    const body = document.querySelector<HTMLElement>('.main__body')
    if (body && lastRoute.current !== null && lastRoute.current !== key) {
      body.classList.remove('is-enter')
      // 读一次布局，让上面那次 remove 落地；否则同一帧里加回来不重启动画。
      void body.offsetWidth
      body.classList.add('is-enter')
    }
    lastRoute.current = key
  }, [shell])

  /*
   * 点面板外面就收起，不必非得去够右上角那个 ✕。
   *
   * 队列和均衡器都是「拉开看一眼就走」的抽屉，桌面播放器的习惯是一点空白
   * 处就收回。以前只认那个关闭键，鼠标已经跑到列表上了还要折返一趟。
   *
   * 两处例外：面板自己（不然拖滚动条也会关），以及播放条——那一排图标里
   * 的队列/均衡器按钮自己会 toggle，在捕获阶段抢先关掉会让按钮看起来失灵。
   */
  useEffect(() => {
    if (!eqOpen && !queueOpen) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('.panel') || target.closest('.player')) return
      setEqOpen(false)
      setQueueOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [eqOpen, queueOpen])

  /*
   * 窗口被拖着改大小的时候，把毛玻璃全关掉。
   *
   * 模糊要按新尺寸重新采样背景，拖动那几帧来不及，屏幕上就会先留着按旧宽度
   * 排好的内容，再「啪」地跳到新布局——用户看见的就是容器大小错位、闪一下。
   * 拖动期间不画模糊，重排就只是一次纯色重绘，肉眼看不到。
   */
  useEffect(() => {
    const off = window.aurora?.app?.onResizing?.((busy) => {
      document.documentElement.classList.toggle('is-resizing', busy)
    })
    return () => {
      if (typeof off === 'function') off()
      document.documentElement.classList.remove('is-resizing')
    }
  }, [])

  /* 舞台是外壳里的一页，但画法是浮层：外壳说在舞台，就把浮层打开。 */
  useEffect(() => {
    if (shell.view === 'stage') setStageOpen(true)
  }, [shell.view])

  /* 手改地址或从标题栏前进/后退时，让外壳跟上。 */
  useEffect(() => {
    const onHashChange = () => {
      const parsed = shellFromHash(window.location.hash)
      if (!parsed) return
      const current = stack[cursor]
      if (current && sameShell(current, parsed)) return
      setStack((prev) => [...prev.slice(0, cursor + 1), parsed])
      setCursor((c) => c + 1)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [stack, cursor])

  const goBack = useCallback(() => setCursor((c) => Math.max(0, c - 1)), [])
  const goForward = useCallback(
    () => setCursor((c) => Math.min(stack.length - 1, c + 1)),
    [stack.length]
  )

  /**
   * Browser preview only: seed the demo library and start playing, so the
   * visual system has real motion to be judged against. Electron never runs
   * this branch - `isNative` is true there.
   */
  useEffect(() => {
    if (isNative) {
      /*
       * The index is read by the profile effect below instead. The library is
       * per profile, and reading it here would run before the main process has
       * been told which profile is active - one frame of the wrong library.
       */
      return
    }
    // A stress run replaces the demo library entirely; seeding both would measure
    // the wrong list. The chunk is fetched only when the flag is set.
    if (STRESS_TRACKS > 0) {
      void import('./preview/stress').then(({ seedStressLibrary }) => {
        seedStressLibrary(STRESS_TRACKS)
        player.playQueue(useLibrary.getState().tracks, 0)
      })
      return
    }
    setTracks(demoLibrary)
    // `#songs-far` starts deep in the list so the auto-scroll is observable.
    player.playQueue(demoLibrary, SCROLL_TEST_MODE ? SCROLL_TEST_START : 0)

    /*
     * `#empty` shows the state that follows adding a folder with no music in it.
     * The folders are already non-empty in the preview (see demoRoots), so
     * clearing the library is enough to reach it.
     */
    if (window.location.hash.replace(/^#/, '') === 'empty') setTracks([])

    // Seed a couple of playlists so the playlists screen has content to judge.
    const store = usePlaylists.getState()
    if (store.playlists.length === 0) {
      const long = store.create('深夜循环', demoLibrary.slice(0, 6).map((t) => t.id))
      store.create('通勤', demoLibrary.slice(10, 16).map((t) => t.id))

      const hash = window.location.hash.replace(/^#/, '')
      if (hash === 'playlist') {
        setStack([{ view: 'playlist', id: long.id }])
        setCursor(0)
      }
      // Opens the album screen on the first album, so the drill-down can be
      // reviewed without a pointer to click with.
      if (hash === 'album') {
        const first = groupAlbums(demoLibrary)[0]
        if (first) {
          setStack([{ view: 'album', id: first.id }])
          setCursor(0)
        }
      }
    }

    const hash = window.location.hash.replace(/^#/, '')
    if (hash === 'stage') setStageOpen(true)
    if (hash === 'eq') setEqOpen(true)
    if (hash === 'queue') setQueueOpen(true)
  }, [setTracks])

  /**
   * Scan once automatically when folders are configured but the index is empty,
   * which is the state right after the user adds their first folder. After
   * that, scanning is explicit: a rescan is a decision, not a surprise.
   */
  const autoScanned = useRef(false)
  useEffect(() => {
    if (!isNative || autoScanned.current) return
    if (ready && tracks.length === 0 && roots.length > 0) {
      autoScanned.current = true
      void runScan()
    }
  }, [ready, tracks.length, roots.length])

  /**
   * Benchmark load, preview only.
   *
   * See PERF_MODE. This exists so the render-cost claim can be re-measured after
   * any change rather than taken on trust.
   */
  useEffect(() => {
    if (!PERF_MODE) return
    const timer = window.setInterval(() => {
      const state = usePlayer.getState()
      state.setPosition(state.position + 1 / 60)
    }, 1000 / 60)
    return () => window.clearInterval(timer)
  }, [])

  /**
   * The Windows thumbnail toolbar shows either play or pause, and the main
   * process cannot know which without being told.
   */
  useEffect(() => {
    if (!isNative) return
    void bridge.player.reportState({ playing })
  }, [playing])

  /** Transport commands from the tray menu and the thumbnail toolbar. */
  useEffect(() => {
    if (!isNative) return
    return bridge.player.onCommand((command) => {
      if (command === 'toggle') player.toggle()
      else if (command === 'next') player.next()
      else player.prev()
    })
  }, [])

  /**
   * The overlay can also be opened from the tray or a global shortcut, so its
   * state is read from the main process rather than assumed locally.
   */
  useEffect(() => {
    if (!isNative) return
    void bridge.overlay.getStatus().then(setOverlayStatus)
    return bridge.overlay.onStatus(setOverlayStatus)
  }, [])

  const toggleDesktopLyrics = useCallback(async () => {
    if (!isNative) return
    setOverlayStatus(await bridge.overlay.toggle(!overlayStatus.open))
  }, [overlayStatus.open])

  /**
   * Say, in the taskbar and window switcher, that the music is still playing.
   *
   * This is the visible half of "background playback": the window stops being
   * observable once it is hidden to the tray, so the one thing a user can still
   * check has to say the truth about what is running.
   */
  useEffect(() => {
    if (!windowVisibility.hidden) {
      document.title = 'Aurora'
      return
    }
    document.title = playing ? `▶ ${track?.title ?? 'Aurora'}` : 'Aurora · 已隐藏'
  }, [windowVisibility.hidden, playing, track?.title])

  /** A fresh install, or a store that lost its active id, still needs a profile. */
  useEffect(() => {
    useAccounts.getState().ensureDefault()

    /*
     * Preview only: give the accounts screen a second profile, so the switch and
     * delete affordances are actually rendered and reviewed rather than assumed.
     */
    if (!isNative && window.location.hash.replace(/^#/, '') === 'accounts') {
      const state = useAccounts.getState()
      if (state.accounts.length < 2) {
        state.create('客厅')
        state.activate(state.accounts[0].id)
      }
    }
  }, [])

  /**
   * Re-point the playlist store at the active profile.
   *
   * This is what makes a profile isolate something. Without it the switcher
   * would only change a label in the sidebar while every profile shared one
   * playlist library - which is worse than not having profiles at all, because
   * it looks like it works.
   *
   * The first run is already taken care of before render (see src/main.tsx);
   * this handles every switch after that.
   */
  useEffect(() => {
    void loadProfilePlaylists(activeAccountId)
    /*
     * Volume, EQ and crossfade are profile-owned too. Loaded here rather than
     * persisted globally so that two profiles on one machine do not argue over
     * the same volume slider.
     */
    void loadProfilePlayerPrefs(activeAccountId)
    /*
     * The online account is part of the profile too, so it is rebound on the
     * same switch. `init` notices the profile changed, drops the previous
     * account's playlists and collection, and asks the main process to point the
     * session at this profile.
     */
    void useNetease.getState().init()
    /*
     * Folders and the scan index are per profile as well. The main process is
     * told which profile before the index is read: doing both at once would
     * read the index of the profile being left.
     */
    void (async () => {
      if (!activeAccountId) return
      await bridge.library.useProfile(activeAccountId)
      await loadInitialIndex()
    })()
  }, [activeAccountId])

  /** Preview only: pop the actions menu so it can be reviewed in a screenshot. */
  useEffect(() => {
    if (!MENU_TEST_MODE || tracks.length < 3) return
    openTrackMenu({ track: tracks[2], x: 400, y: 290 })
  }, [tracks])

  useKeyboardShortcuts({
    stageOpen,
    eqOpen,
    queueOpen,
    volume,
    canGoBack: cursor > 0,
    goBack,
    setStageOpen,
    setEqOpen,
    setQueueOpen,
    roam: roamNow
  })


  const { albums, artists, trackById, activePlaylist, playlistTracks, albumDetail } = useLibraryData(
    route,
    tracks,
    legacyPlaylists
  )

  const { playAlbum } = useTrackActions({ albums, trackById })

  const { exportPlaylist } = usePlaylistFiles({
    tracks,
    activePlaylist,
    playlistTracks: playlistTracks.tracks,
    navigate,
    onMessage: setFlash
  })

  /**
   * Harness only: give the search screen something to search for.
   *
   * Without this the preview screen shows an empty field and its own empty state,
   * which would prove nothing about whether results render.
   */
  useEffect(() => {
    if (!SEARCH_TEST_QUERY) return
    useSearch.getState().setQuery(SEARCH_TEST_QUERY)
    // The local source is the only one a browser preview can answer from.
    if (SEARCH_TEST_LOCAL) useSearch.getState().setSource('local')
    void useSearch.getState().submit(useLibrary.getState().tracks)
  }, [])

  /** Adding folders is only useful once they are indexed, so scan right after. */
  const addFolders = useCallback(async () => {
    /*
     * Failure has to be visible.
     *
     * This used to be a bare await: if the main process rejected - a dialog that
     * could not open, a settings file that could not be written - the promise
     * rejected into nothing and the button simply did nothing at all. "The button
     * is dead" is indistinguishable from "it worked and found no music", which is
     * the worst possible way to report a problem.
     */
    try {
      const next = await add()
      if (isNative && next.length > 0) await runScan()
    } catch (error) {
      setFlash(`加入文件夹失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [add])

  /*
   * The header says what the screen is, and - only when there is something to
   * report - what is happening. Every view used to carry a one-line description
   * of itself ("按唱片整理"), which is the kind of text you read once and then
   * scroll past forever.
   */
  /**
   * 只有本机文件那几页才该出现「重新扫描 / 添加文件夹」。
   *
   * 它们扫的是磁盘上的目录，在线平台与账号页没有文件可扫——以前那两个按钮
   * 跟着「音乐库」这一层到处出现，在别人的目录和头像列表下面显得莫名其妙。
   */
  const fileTools = shell.view === 'local' || shell.view === 'album'
  const headTitle = SHELL_TITLES[shell.view]
  /*
   * Only scan state belongs here now. The header used to also report "N tracks"
   * while the shell's field was filtering the library in place; filtering moved to
   * the search screen, so there is no filtered count to report.
   */
  const headStatus = scanning
    ? `正在扫描 ${Math.round(progress * 100)}%${
        currentScan ? `，${currentScan.split(/[\\/]/).pop()}` : ''
      }`
    : scanError
      ? scanError
      : null

  /*
   * One search field, one meaning.
   *
   * The field always edits the search screen's query and Enter always goes there;
   * the screen owns the source tabs. The previous version made the field filter
   * the library on local pages and issue a Netease request on the online page,
   * which meant the same control silently did different things depending on where
   * you were - and did nothing at all on the online page. Following the reference
   * player, "which catalogue" is now a visible choice, not an implicit one.
   */
  const searchQuery = useSearch((s) => s.query)
  const searchValue = searchQuery
  /*
   * The placeholder states the action; the hover title states the scope.
   *
   * Listing every catalogue in the field itself made it read like a spec sheet
   * ("搜索本机曲库与网易云、QQ、酷狗、汽水") and left no room for a normal-length
   * phrase. The registry still decides the scope, so adding a provider needs no
   * edit here - it just moves to the tooltip.
   */
  const availableProviders = useAvailableProviders()
  const searchScope = useMemo(() => {
    const names = availableProviders.map((provider) => provider.shortName ?? provider.displayName)
    return names.length > 0 ? `本机曲库与${names.join('、')}` : '本机曲库'
  }, [availableProviders])
  const searchPlaceholder = '搜索歌曲、歌手、专辑'

  const onSearchInput = useCallback((next: string) => {
    useSearch.getState().setQuery(next)
  }, [])

  /*
   * 回车进搜索页，结果只在那儿显示。
   *
   * 顶栏那个框只是入口：在那里敲词、回车，然后整页看结果。不在框下面再开一个
   * 浮窗——同一份结果画两遍，改一处就得改两处。
   */
  const submitSearch = useCallback(() => {
    navigate({ view: 'search' })
    void useSearch.getState().submit(useLibrary.getState().tracks)
  }, [navigate])

  const body = () => {
    // 这三个是外壳自己的页面，旧的 `Route` 里没有对应项，所以放在最前面。
    if (shell.view === 'onlinealbum' || shell.view === 'onlineartist' || shell.view === 'onlineplaylist') {
      return <OnlinePage route={shell} onMenu={openTrackMenu} />
    }
    if (shell.view === 'home') {
      return <HomePage onNavigate={goShell} />
    }
    if (shell.view === 'daily') return <DailyPage onNavigate={goShell} onMenu={openTrackMenu} />
    if (shell.view === 'recent') return <RecentPage onNavigate={navigate} onMenu={openTrackMenu} />
    if (shell.view === 'liked') return <LikedPage onNavigate={goShell} onMenu={openTrackMenu} />
    if (shell.view === 'collections') return <CollectionsPage onNavigate={goShell} />
      if (shell.view === 'playlists') return <PlaylistsPage onNavigate={goShell} />
    if (shell.view === 'local') return <LocalPage onNavigate={goShell} onMenu={openTrackMenu} />
    if (shell.view === 'nowplaying') {
      return (
        <NowPlayingPage
          track={track}
          lyrics={lyrics}
          duration={duration}
          playing={playing}
          onBack={goBack}
          onSeek={(seconds) => player.seekTo(seconds)}
          onSeekRatio={(ratio) => player.seekRatio(ratio)}
          onOpenStage={() => setStageOpen(true)}
        />
      )
    }
    if (shell.view === 'track' && shell.id) {
      return (
        <TrackView
          id={shell.id}
          onOpenLocal={() => goShell({ view: 'local' })}
          onOpenNow={(at) => {
            goShell({ view: 'nowplaying' })
            if (typeof at === 'number') player.seekTo(at)
          }}
        />
      )
    }
    if (shell.view === 'artist' && shell.id) {
      const found = artists.find((item) => item.id === shell.id) ?? null
      if (found) {
        const own = tracks.filter((item) => item.albumArtist === found.name)
        const ownAlbums = albums.filter((item) => found.albumIds.includes(item.id))
        return (
          <ArtistPage
            artist={found}
            albums={ownAlbums}
            tracks={own}
            currentId={track?.id ?? null}
            playing={playing}
            onPlayAt={(index) => player.playQueue(own, index)}
            onOpenAlbum={(id) => goShell({ view: 'album', id })}
            onMenu={openTrackMenu}
          />
        )
      }
    }
    if (view === 'sources') return <Sources roots={roots} onAdd={addFolders} onRemove={remove} busy={busy} />
    if (view === 'settings') return <SettingsPage />
    // Search is its own screen: it answers from either catalogue, so it cannot be
    // a mode of the library views or of the online one.
    if (view === 'search') return <SearchView onMenu={openTrackMenu} />
    // 平台不是目的地。网易云、QQ、酷狗都只是来源，内容分别落进推荐、我喜欢的、
    // 歌单与搜索里；这两个旧地址统一落到歌单页，旧书签点了不至于白屏。
    if (view === 'netease' || view === 'qq') return <PlaylistsPage onNavigate={goShell} />
    // 账号（谁在用、登了哪些平台）是单独一页：它不是偏好设置，而是侧栏底部
    // 那张头像点进来的地方。页面内容见 src/views/AccountPage.tsx。
    if (view === 'accounts') return <AccountPage onNavigate={navigate} />

    // Playlists come before the empty-library check: a playlist can hold tracks
    // from a folder that is not currently in the library, and the management UI
    // has to stay reachable when the library happens to be empty.
    if (view === 'playlists') {
      if (activePlaylist) {
        return (
          <PlaylistDetailPage
            playlist={activePlaylist}
            tracks={playlistTracks.tracks}
            missingCount={playlistTracks.missing}
            currentId={track?.id ?? null}
            playing={playing}
            onPlayAt={(index) => player.playQueue(playlistTracks.tracks, index)}
            onMove={(from, to) => usePlaylists.getState().move(activePlaylist.id, from, to)}
            onRemoveAt={(index) => usePlaylists.getState().removeAt(activePlaylist.id, index)}
            onExport={() => void exportPlaylist()}
            onRename={(name) => usePlaylists.getState().rename(activePlaylist.id, name)}
          />
        )
      }
      return <PlaylistsPage onNavigate={goShell} />
    }

    if (view === 'albums') {
      if (albumDetail) {
        return (
          <AlbumDetailPage
            album={albumDetail.album}
            tracks={albumDetail.tracks}
            currentId={track?.id ?? null}
            playing={playing}
            onPlayAll={() => playAlbum(albumDetail.album.id)}
            onPlayAt={(index) => {
              const byId = new Map(tracks.map((t) => [t.id, t]))
              const ordered = albumDetail.album.trackIds
                .map((id) => byId.get(id))
                .filter((t): t is Track => Boolean(t))
              player.playQueue(ordered, index)
            }}
            onOpenArtist={(artistId) => navigate({ view: 'artists', artistId })}
            onMenu={openTrackMenu}
          />
        )
      }

      return <LocalPage onNavigate={goShell} onMenu={openTrackMenu} initialTab="albums" />
    }
    if (view === 'artists') {
      return <LocalPage onNavigate={goShell} onMenu={openTrackMenu} initialTab="artists" />
    }
    return null
  }

  return (
    <>
      <div
        className={`shell${collapsed ? ' is-collapsed' : ''}${track?.hasArt ? ' has-art' : ''}${
          wallpaperEntry ? ' has-wallpaper' : ''
        }${shell.view === 'nowplaying' ? ' is-nowplaying' : ''}`}
        // The veil opacity is CSS's business; the level itself is data.
        style={{ '--wp-level': String(wallpaperStrength) } as React.CSSProperties}
      >
        {/*
          The stage paints the same wallpaper over the whole window, so the
          shell's copy is dropped while it is open: two WebGL scene instances
          at 30fps each would double the GPU bill for one visible picture.
        */}
        {stageOpen ? null : <Backdrop entry={wallpaperEntry} />}
        {backdrop ? (
          <div
            className="shell__backdrop"
            // The scrim lives in CSS; only the artwork URL is data.
            style={{ '--backdrop-url': `url("${backdrop}")` } as React.CSSProperties}
            aria-hidden="true"
          />
        ) : null}
        <TitleBar
          query={searchValue}
          onQuery={onSearchInput}
          onSubmit={submitSearch}
          placeholder={searchPlaceholder}
          hint={searchScope}
          shortcut={view === 'netease' ? undefined : 'Ctrl K'}
          onBack={goBack}
          onForward={goForward}
          canBack={cursor > 0}
          canForward={cursor < stack.length - 1}
          onHome={() => goShell({ view: 'home' })}
        />

        <Rail
          route={shell}
          onNavigate={goShell}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          profileLabel={activeAccount?.label ?? null}
          onOpenProfile={() => goShell({ view: 'me' })}
          albumCount={albums.length}
          artistCount={artists.length}
          onRoam={roamNow}
        />

        <main className="main">
          <div className="main__header" hidden={shell.view === 'home'}>
            {shell.view === 'artist' ? (
              <button
                className="icon-btn"
                onClick={() => goShell({ view: 'local' })}
                title="返回本机音乐"
                aria-label="返回本机音乐"
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}

            {shell.view === 'nowplaying' || shell.view === 'track' ? (
              <button
                className="icon-btn"
                onClick={goBack}
                title="返回"
                aria-label="返回"
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}

            {shell.view === 'playlist' ? (
              <button
                className="icon-btn"
                onClick={() => goShell({ view: 'playlists' })}
                title="返回歌单"
                aria-label="返回歌单"
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}

            {shell.view === 'album' ? (
              <button
                className="icon-btn"
                onClick={() => goShell({ view: 'local' })}
                title="返回本机音乐"
                aria-label="返回本机音乐"
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}

            <div className="main__titles">
              {headTitle ? <h1 className="main__title">{headTitle}</h1> : null}
              {headStatus ? <div className="main__sub">{headStatus}</div> : null}
            </div>

            <div className="main__tools">
              {shell.view === 'nowplaying' ? (
                <button className="btn np-act" onClick={() => setQueueOpen((open) => !open)} title="播放队列">
                  <Queue size={15} />
                  队列
                </button>
              ) : null}
              {shell.view === 'nowplaying' ? (
                <button className="btn np-act np-act--stage" onClick={() => setStageOpen(true)} title="舞台 (L)">
                  <Expand size={15} />
                  舞台
                </button>
              ) : null}
              {/*
                The library's own actions only belong to the library.
                "Rescan" and "add folder" are about files on this disk, so they
                appear on the screens that show those files and nowhere else. On
                the online screen they were leftovers above someone else's
                catalogue; on the profiles screen they were a stray button about
                folders next to a list of people.
              */}
              {isNative && fileTools ? (
                <button
                  className="btn"
                  onClick={() => void runScan()}
                  disabled={scanning || roots.length === 0}
                  title={roots.length === 0 ? '先添加一个音乐文件夹' : '重新扫描曲库'}
                >
                  <Refresh size={15} />
                  {scanning ? `${Math.round(progress * 100)}%` : '重新扫描'}
                </button>
              ) : null}
              {fileTools ? (
                <button className="btn" onClick={() => void addFolders()} disabled={busy}>
                  <Plus size={15} />
                  添加文件夹
                </button>
              ) : null}
            </div>
          </div>

          <UpdateBar />

          {scanning ? (
            <div
              className="scanbar"
              role="progressbar"
              aria-label="扫描进度"
              aria-valuenow={Math.round(progress * 100)}
            >
              <div className="scanbar__fill" style={{ width: `${Math.max(2, progress * 100)}%` }} />
            </div>
          ) : null}

          {flash ? (
            <div className="flash" role="status">
              <span>{flash}</span>
              <button className="icon-btn" onClick={() => setFlash(null)} title="关闭" aria-label="关闭提示">
                <Close size={15} />
              </button>
            </div>
          ) : null}

          {/* 换页时换 key：新内容整块重挂，入场动画才会播（.main__body 上那条 pageIn）。 */}
          <div className="main__body" key={shell.view + ':' + (shell.id ?? '')}>{body()}</div>
        </main>

        <PlayerBar
          track={track}
          playing={playing}
          loading={loading}
          duration={duration}
          volume={volume}
          muted={muted}
          shuffle={shuffle}
          repeat={repeat}
          eqOpen={eqOpen}
          desktopLyricsOpen={overlayStatus.open}
          queueLength={queueLength}
          onToggle={() => player.toggle()}
          onNext={() => player.next()}
          onPrev={() => player.prev()}
          onSeekRatio={(ratio) => player.seekRatio(ratio)}
          onVolume={(next) => player.setVolume(next)}
          onToggleMute={() => player.toggleMute()}
          onToggleShuffle={() => player.toggleShuffle()}
          onCycleRepeat={() => player.cycleRepeat()}
          onOpenNow={() => goShell({ view: 'nowplaying' })}
          onOpenStage={() => setStageOpen(true)}
          // The two side panels occupy the same slot, so opening one closes
          // the other rather than stacking them.
          onToggleEq={() => {
            setEqOpen((open) => !open)
            setQueueOpen(false)
          }}
          onOpenQueue={() => {
            setQueueOpen((open) => !open)
            setEqOpen(false)
          }}
          onToggleDesktopLyrics={() => void toggleDesktopLyrics()}
        />

        <EqPanel
          open={eqOpen}
          enabled={eqEnabled}
          gains={eqGains}
          onToggle={(enabled) => player.setEqEnabled(enabled)}
          onGain={(index, gain) => {
            const next = [...eqGains]
            next[index] = gain
            player.setEqGains(next)
          }}
          onPreset={(gains) => player.setEqGains(gains)}
          onClose={() => setEqOpen(false)}
        />

        <QueuePanel
          open={queueOpen}
          onClose={() => setQueueOpen(false)}
          onOpenLibrary={() => {
            setQueueOpen(false)
            goShell({ view: 'local' })
          }}
        />
      </div>

      {/*
        喜欢到哪儿。只在同一首歌有好几个版本时出现；一个版本时行上的心形
        直接切换，不再多问一句。
      */}
      <LikeMenu />

      {/* 下载浮条：右下角一枚小胶囊，展开是任务列表。 */}
      <DownloadsDock />

      {/*
        Actions menu. Held by the app rather than by a row, because only one can
        be open at a time and rows are recycled as the library changes.
      */}
      {trackMenu ? (
        <TrackMenu
          track={trackMenu.track}
          x={trackMenu.x}
          y={trackMenu.y}
          closing={menuClosing}
          playlists={writablePlaylists}
          onClose={() => closeTrackMenu()}
          onOpenDetail={() => {
            const target = trackMenu.track
            closeTrackMenu()
            goShell({ view: 'track', id: target.id })
          }}
          onPlayNext={() => {
            player.addToQueue([trackMenu.track], 'next')
            closeTrackMenu()
            setFlash(`已把《${trackMenu.track.title}》排到下一首`)
          }}
          onRoam={() => {
            const seed = trackMenu.track
            closeTrackMenu()
            roamNow(seed)
          }}
          onDownload={
            trackMenu.track.source
              ? () => {
                  const request = downloadRequestOf(trackMenu.track)
                  closeTrackMenu()
                  if (!request) {
                    setFlash('这首歌取不到音源，没法下载')
                    return
                  }
                  void useDownloads.getState().enqueue(request).then((queued) => {
                    setFlash(
                      queued ? `已把《${request.title}》加进下载` : '浏览器预览模式没有下载能力'
                    )
                  })
                }
              : undefined
          }
          onAddToPlaylist={(key) => {
            const [providerId, rawId] = key.split(':')
            const id = Number(rawId)
            const target = trackMenu.track
            closeTrackMenu()
            if (!providerId || !Number.isFinite(id)) return
            void addTrackToOnlinePlaylist(providerId, id, target).then((result) => {
              reportWrite(result, '已加入歌单')
            })
          }}
          onRemoveFromPlaylist={
            trackMenu.onlinePlaylist
              ? () => {
                  const { providerId, id } = trackMenu.onlinePlaylist!
                  const target = trackMenu.track
                  closeTrackMenu()
                  void removeTrackFromOnlinePlaylist(providerId, id, target).then((result) => {
                    reportWrite(result, '已移出这张歌单')
                    if (result.ok) refreshOnlinePlaylist(providerId, id)
                  })
                }
              : undefined
          }
          onReveal={() => {
            void bridge.library.reveal(trackMenu.track.path)
            closeTrackMenu()
          }}
        />
      ) : null}

      {/* Renders nothing; projects lyric state into the desktop overlay window. */}
      <DesktopLyricsBridge
        lyrics={lyrics}
        track={track}
        playing={playing}
        overlayOpen={overlayStatus.open}
      />

      {/*
        The stage is a sibling of the shell, not a child of it: it is a
        document-level overlay, and keeping it outside the grid makes that
        structural rather than a CSS ordering accident.
      */}
      {stage.mounted ? (
        <LyricsStage
          closing={stage.closing}
          track={track}
          lyrics={lyrics}
          duration={duration}
          playing={playing}
          palette={palette}
          getSpectrum={() => driver.getSpectrum()}
          onlineEnabled={lyricsOnline}
          onEnableOnline={() => void setLyricsOnline(true)}
          onSeek={(seconds) => player.seekTo(seconds)}
          onSeekRatio={(ratio) => player.seekRatio(ratio)}
          onToggle={() => player.toggle()}
          onClose={() => {
          setStageOpen(false)
          if (shell.view === 'stage') goShell({ view: 'home' })
        }}
        />
      ) : null}

      {/*
        液态玻璃的折射定义。它只产出一个 0×0 的 <svg><defs>，具体挂到哪些元素由
        组件内的选择器表决定，所以放在最外层、不占布局，也不必进 App 的网格。
      */}
      <Refraction />
    </>
  )
}
