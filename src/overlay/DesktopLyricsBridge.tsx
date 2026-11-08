import { useEffect, useRef } from 'react'
import { bridge, isNative } from '../bridge'
import { activeLineAt, type Lyrics } from '../features/lyrics/lrc'
import { usePlayer } from '../features/player/store'
import type { Track } from '../types'

interface DesktopLyricsBridgeProps {
  lyrics: Lyrics
  track: Track | null
  playing: boolean
  /** Whether the desktop lyric window is on screen. Pushing while it is closed is waste. */
  overlayOpen: boolean
}

/**
 * Feeds the desktop lyric window.
 *
 * Subscribes to the *derived active line index* rather than to `position`, so
 * crossing the process boundary happens a handful of times per song instead of
 * sixty times a second. Measured at 0.25 pushes/second (10 per 40-second song)
 * by scripts/probe-aurora-bg.mjs - the same trick that keeps the stage from
 * re-rendering also keeps this IPC channel quiet.
 *
 * The strip walks the fill forward on its own from the position handed over with
 * each push, which is why a line-level channel can still paint a per-second
 * progress without a second stream of messages.
 *
 * Renders nothing: it exists purely to project player state into the overlay
 * window.
 */
export function DesktopLyricsBridge({ lyrics, track, playing, overlayOpen }: DesktopLyricsBridgeProps) {
  const active = usePlayer((state) => activeLineAt(lyrics.lines, state.position))
  const duration = usePlayer((state) => state.duration)
  /*
   * A coarse copy of the position, only so a seek is noticed.
   *
   * The strip walks its own clock from the position handed over with a line, so it
   * drifts once the user drags the seek bar - nothing would correct it until the
   * next line change. One re-render every five seconds re-anchors it, which costs
   * a handful of pushes per song and keeps a seek from being visible for more than
   * a few seconds.
   */
  const bucket = usePlayer((state) => Math.floor(state.position / 5))
  /**
   * The payload is the dependency list made explicit.
   *
   * The component only re-renders when one of these changes, but `lyrics` is a
   * new object on every track change, so comparing the rendered values is what
   * keeps one track change from producing two identical pushes. It also has to be
   * a ref rather than state: this must not trigger a render of its own.
   */
  const lastPushed = useRef<string | null>(null)

  useEffect(() => {
    if (!isNative) return

    const lineAt = (index: number): string | null => {
      const text = lyrics.lines[index]?.text?.trim()
      return text ? text : null
    }

    const current = lyrics.lines[active]
    const following = lyrics.lines[active + 1]
    /*
     * Read once per push instead of subscribing: the position changes every frame
     * and this component must not re-render on it. The strip only needs the value
     * at the moment a line is handed over.
     */
    const position = usePlayer.getState().position
    // The artwork accent lives in a CSS variable on the player document; reading
    // it here is what lets the sung part of the line match the cover.
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()

    const payload = {
      // Null while there is no lyric means the overlay falls back to showing the
      // track title, which keeps it useful for instrumentals.
      text: lyrics.empty ? null : lineAt(active),
      next: lyrics.empty ? null : lineAt(active + 1),
      title: track?.title ?? '',
      artist: track?.artist ?? '',
      playing,
      at: lyrics.empty || !current ? null : current.time,
      to: lyrics.empty || !following ? null : following.time,
      position,
      duration,
      accent: accent || '#7d8899'
    }

    /*
     * Nothing on screen can show this yet.
     *
     * The strip in the tray is a different window, so this is not a
     * visibility check on the player: it is the cheaper, unambiguous fact that
     * there is no overlay window at all. The main process keeps the state it was
     * last given and replays it when the window opens (electron/lyrics-overlay.ts
     * `open()` calls `sendState()`), so a reopened strip is never stale - but
     * while it is closed this IPC produced nothing anyone could see.
     */
    if (!overlayOpen) {
      lastPushed.current = null
      return
    }

    const key = JSON.stringify([
      payload.text,
      payload.next,
      payload.title,
      payload.artist,
      payload.playing,
      payload.at,
      payload.to,
      payload.duration,
      payload.accent,
      // The anchor itself is part of the identity: a seek that lands inside the
      // same line must still reach the strip.
      Math.round(payload.position * 10)
    ])
    if (key === lastPushed.current) return
    lastPushed.current = key
    void bridge.overlay.push(payload)
  }, [active, bucket, lyrics, track?.title, track?.artist, playing, overlayOpen, duration])

  return null
}
