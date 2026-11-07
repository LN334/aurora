import { useEffect, useMemo, useRef, useState } from 'react'
import type { WallpaperEntry } from '../../env'
import { propertyValues } from './pure'
import type { PropertyValue } from './pure'
import { useWallpaper } from './store'

interface SceneInstance {
  destroy(): void
  /**
   * 停止/恢复出帧。lib 的帧循环是 30fps 的 WebGL 渲染，窗口最小化、切到别的
   * 应用或锁屏时没人看得见它，继续跑就是白烧 GPU 和电。
   */
  pause?(): void
  resume?(): void
  /**
   * 改一项壁纸自带的属性（亮度、配色、开关……）。不重建场景——工程作者把
   * 这些值接进自己的着色器，改完下一帧就变。
   */
  setProperties?(props: Record<string, PropertyValue>): void
}

/**
 * The Wallpaper Engine wallpaper behind the shell.
 *
 * Four kinds of project, four renderers:
 *
 * - **scene** - runs inside the shell through WebWallGL, which decodes the same
 *   `scene.pkg` Wallpaper Engine uses. This is the only kind that has to be
 *   imported lazily: the WebGL engine is about a megabyte, and a user with a
 *   video wallpaper should never pay for it.
 * - **video / web / image** - the file itself is the wallpaper, so it is handed
 *   to a `<video>`, an `<iframe>` or an `<img>` over `aurora-wallpaper://`.
 *
 * A scene project without a `.pkg` (or one whose shader rejects our GL context)
 * falls back to its preview image instead of leaving the shell black.
 */
/**
 * 场景第一次挂载时让界面先出来。
 *
 * 启动瞬间同时做三件事最吃亏：React 首帧、WebGL 引擎求值（懒块 1.1 MB）、
 * 场景包解码。壁纸是背景，晚一两帧没人看得出来，界面晚一两帧却很明显。
 * 之后用户主动换壁纸不推迟——那时候他正盯着画面等结果。
 *
 * 只让出 120ms（约两帧多一点），不是半秒：实测主进程那 137 MB 的包读盘只占
 * 0.5s，真正慢的是 parsePkg + 纹理上传的 2.2s 主线程长任务，等得再久也不省。
 */
let firstMountDone = false

export function Backdrop({ entry }: { entry: WallpaperEntry | null }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const instanceRef = useRef<SceneInstance | null>(null)
  const [sceneFailed, setSceneFailed] = useState(false)
  const [sceneReady, setSceneReady] = useState(false)
  const runsScene = entry?.kind === 'scene' && entry.hasPackage

  /*
   * 工程默认值 + 用户在设置页改过的覆盖值。订阅的是「当前这张壁纸」那一格，
   * 换壁纸时自然拿到新的一套，不会把上一张的键传进新场景。
   */
  const saved = useWallpaper((state) => (entry ? state.values[entry.id] : undefined))
  const props = useMemo(() => propertyValues(entry?.properties, saved), [entry?.properties, saved])
  /*
   * 挂载是异步的（懒块 + 解包），读 ref 而不是闭包里的 props，这样挂载期间
   * 用户刚拖的那一下也能带上；effect 里也就不用把 props 列进依赖、避免重建场景。
   */
  const propsRef = useRef(props)
  propsRef.current = props

  /**
   * 窗口藏起来的时候不要继续画。
   *
   * 场景壁纸是常驻的 30fps WebGL 循环，视频壁纸是常驻的 <video>：最小化到
   * 任务栏、切到别的窗口、锁屏之后它们仍然在解码和出帧，白白吃 GPU 和电。
   * Chromium 在窗口最小化时会把页面标成 hidden（visibilitychange），
   * 这里据此暂停，回到前台再恢复。
   *
   * 只在「隐藏/可见」之间切换时动手，恢复时保留用户原本的播放状态：
   * 视频壁纸本来就没声音，恢复时静音播放即可。
   */
  useEffect(() => {
    const apply = () => {
      const hidden = document.visibilityState === 'hidden'
      const instance = instanceRef.current
      try {
        if (hidden) instance?.pause?.()
        else instance?.resume?.()
      } catch {
        // 已销毁的实例会抛；这里只是省电，不值得让界面报错。
      }
      const video = videoRef.current
      if (!video) return
      if (hidden) {
        video.pause()
      } else {
        void video.play().catch(() => {
          // 自动播放策略或空源会让 play() 失败；壁纸是背景，静默即可。
        })
      }
    }
    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [entry?.id, entry?.kind])

  useEffect(() => {
    setSceneFailed(false)
    setSceneReady(!runsScene)
    if (!runsScene || !entry) return

    const host = hostRef.current
    if (!host) return

    /*
     * `disposed` is checked twice around the await: mounting a scene takes long
     * enough that the user can switch wallpaper again mid-import, and a scene
     * that finishes mounting after its element is gone would keep a WebGL
     * context (and its frame loop) alive for the rest of the session.
     */
    let disposed = false
    let instance: SceneInstance | null = null
    let timer = 0

    /*
     * 渲染分辨率上限。场景按这个倍数光栅化，纹理显存与片元开销都随像素数
     * 线性走：这台机器 dpr 1.5 时全屏约 2.7 M 像素，压到 1.25 直接省三成。
     * 壁纸是被压在面板下面的背景，不值得为它开满物理像素。
     */
    const dpr = window.devicePixelRatio || 1
    const pixels = Math.max(1, window.innerWidth * window.innerHeight)
    const renderDpr = Math.max(0.75, Math.min(dpr, 1.25, Math.sqrt(2_600_000 / pixels)))

    const start = async () => {
      try {
        const { mount, httpSource } = await import('webwallgl')
        if (disposed) return
        instance = await mount(host, {
          source: httpSource(entry.sourceUrl),
          fit: 'cover',
          // 30 fps is what a background needs; the scene is not the subject.
          fps: 30,
          renderDpr,
          // 工程自带的属性：作者在 project.json 里声明的可调项，用户改过的值优先。
          properties: propsRef.current,
          // The player owns the audio graph - a wallpaper must never make sound.
          volume: 0
        })
        instanceRef.current = instance
        if (disposed) {
          instance.destroy()
          instance = null
          instanceRef.current = null
        } else {
          setSceneReady(true)
          if (document.visibilityState === 'hidden') {
            // 挂载发生在隐藏状态（启动时窗口就最小化）：先别开始出帧。
            instance.pause?.()
          }
        }
      } catch (error) {
        console.error('[aurora] wallpaper scene failed to mount', error)
        if (!disposed) setSceneFailed(true)
      }
    }

    const delay = firstMountDone ? 0 : 120
    firstMountDone = true
    if (delay > 0) timer = window.setTimeout(() => void start(), delay)
    else void start()

    return () => {
      window.clearTimeout(timer)
      disposed = true
      try {
        instance?.destroy()
      } catch {
        // A destroyed context throws on destroy; nothing left to clean up.
      }
      instance = null
      instanceRef.current = null
      host.replaceChildren()
    }
  }, [runsScene, entry?.id, entry?.sourceUrl])

  /*
   * 拖动滑杆改属性时不用重建场景，直接把新值推给已挂载的实例。
   * 挂载完成前 instanceRef 是空的，那一次由 mount 的 options 带上。
   */
  useEffect(() => {
    const instance = instanceRef.current
    if (!instance?.setProperties) return
    try {
      instance.setProperties(props)
    } catch {
      // 实例可能刚被销毁；属性是外观，不值得让界面报错。
    }
  }, [props])

  if (!entry) return null

  const sceneFallback = entry.kind === 'scene' && (!entry.hasPackage || sceneFailed)

  return (
    <div
      className={`wallpaper wallpaper--${sceneFallback ? 'scene' : entry.kind}${sceneReady ? ' is-ready' : ''}`}
      aria-hidden="true"
      data-title={entry.title}
    >
      {runsScene && !sceneFailed ? <div className="wallpaper__scene" ref={hostRef} /> : null}

      {sceneFallback && entry.previewUrl ? (
        <img className="wallpaper__media" src={entry.previewUrl} alt="" />
      ) : null}

      {entry.kind === 'video' ? (
        <video
          ref={videoRef}
          className="wallpaper__media"
          src={entry.entryUrl ?? entry.sourceUrl}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : null}

      {entry.kind === 'web' ? (
        <iframe
          className="wallpaper__media"
          src={entry.entryUrl ?? entry.sourceUrl}
          title=""
          tabIndex={-1}
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        />
      ) : null}

      {entry.kind === 'image' ? (
        <img className="wallpaper__media" src={entry.entryUrl ?? entry.sourceUrl} alt="" />
      ) : null}

      <div className="wallpaper__veil" />
    </div>
  )
}