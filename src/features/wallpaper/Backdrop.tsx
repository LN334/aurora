import { useEffect, useRef, useState } from 'react'
import type { WallpaperEntry } from '../../env'

interface SceneInstance {
  destroy(): void
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
export function Backdrop({ entry }: { entry: WallpaperEntry | null }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [sceneFailed, setSceneFailed] = useState(false)
  const runsScene = entry?.kind === 'scene' && entry.hasPackage

  useEffect(() => {
    setSceneFailed(false)
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

    void (async () => {
      try {
        const { mount, httpSource } = await import('webwallgl')
        if (disposed) return
        instance = await mount(host, {
          source: httpSource(entry.sourceUrl),
          fit: 'cover',
          // 30 fps is what a background needs; the scene is not the subject.
          fps: 30,
          // The player owns the audio graph - a wallpaper must never make sound.
          volume: 0
        })
        if (disposed) {
          instance.destroy()
          instance = null
        }
      } catch (error) {
        console.error('[aurora] wallpaper scene failed to mount', error)
        if (!disposed) setSceneFailed(true)
      }
    })()

    return () => {
      disposed = true
      try {
        instance?.destroy()
      } catch {
        // A destroyed context throws on destroy; nothing left to clean up.
      }
      instance = null
      host.replaceChildren()
    }
  }, [runsScene, entry?.id, entry?.sourceUrl])

  if (!entry) return null

  const sceneFallback = entry.kind === 'scene' && (!entry.hasPackage || sceneFailed)

  return (
    <div
      className={`wallpaper wallpaper--${sceneFallback ? 'scene' : entry.kind}`}
      aria-hidden="true"
      data-title={entry.title}
    >
      {runsScene && !sceneFailed ? <div className="wallpaper__scene" ref={hostRef} /> : null}

      {sceneFallback && entry.previewUrl ? (
        <img className="wallpaper__media" src={entry.previewUrl} alt="" />
      ) : null}

      {entry.kind === 'video' ? (
        <video
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
