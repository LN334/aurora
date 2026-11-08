import { useEffect, useRef, useState } from 'react'
import { Close, Lock, Next, Pause, Play, Prev, Unlock } from '../ui/icons'
import { bridge } from '../bridge'
import type { OverlayState } from '../env'

/**
 * Font size belongs to the main process now (it is also a setting), so this file
 * only remembers the key an older build wrote.
 */
const SIZE_KEY = 'aurora.desktopLyrics.size'
const DEFAULT_SIZE = 34

const IDLE: OverlayState = {
  text: null,
  next: null,
  title: '',
  artist: '',
  playing: false,
  at: null,
  to: null,
  position: 0,
  duration: 0,
  accent: ''
}

/**
 * The desktop lyric strip.
 *
 * Three layers, in reading order of importance:
 *
 *  - **the words** carry no plate at all. A dark rectangle floating on the
 *    desktop looked like a rendering mistake; what the text actually needs is
 *    local contrast, which the shadow stack on the base layer provides.
 *  - **the fill** is the same words again, clipped to the part already sung and
 *    painted in the artwork accent. It is what makes the strip feel alive
 *    instead of like a line of text that changes every four seconds.
 *  - **the toolbar** is a single opaque pill under the words. It only fades in
 *    on hover, but always occupies its space, so the window and its hit box
 *    never resize while the pointer is moving.
 *
 * Three interaction states matter:
 *
 *  - **locked** the window ignores the mouse, so it never eats a click meant for
 *    the app underneath. While the pointer is over the strip the window takes the
 *    mouse back, which is what makes the toolbar reachable without unlocking;
 *  - **hovered** the pointer is on the strip, so the toolbar fades in;
 *  - **unlocked** the window takes the mouse everywhere it covers, for dragging.
 */
export function Overlay() {
  const [state, setState] = useState<OverlayState>(IDLE)
  const [locked, setLocked] = useState(true)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [hovering, setHovering] = useState(false)
  const stack = useRef<HTMLDivElement | null>(null)
  const fill = useRef<HTMLSpanElement | null>(null)

  useEffect(() => bridge.overlay.onState(setState), [])

  useEffect(() => {
    void bridge.overlay.getStatus().then((status) => {
      setLocked(status.locked)
      setSize(status.size)
    })
  }, [])

  /*
   * The size lives in the main process, not here.
   *
   * It used to be this window's own `localStorage`, which made it invisible to
   * the settings page - the two windows could disagree and neither could see the
   * other. The main process is now the single source, this window and the
   * settings page both write to it, and the change comes back as `overlay:size`.
   */
  useEffect(() => {
    const stop = bridge.overlay.onSize(setSize)
    // One-time migration: a value left behind by an older build is handed over
    // and then removed, so there is only ever one answer from here on.
    const legacy = Number.parseInt(localStorage.getItem(SIZE_KEY) ?? '', 10)
    if (Number.isFinite(legacy)) {
      localStorage.removeItem(SIZE_KEY)
      void bridge.overlay.setSize(Math.min(64, Math.max(18, legacy)))
    }
    return stop
  }, [])

  /*
   * Hover is reported by the main process, not measured here.
   *
   * A locked window ignores the mouse entirely, so the page sees no pointer
   * events at all - it cannot tell whether the cursor is on the words. The main
   * process polls the cursor against the box this window reports below.
   */
  useEffect(() => bridge.overlay.onHover(setHovering), [])

  /*
   * Report the stack's box whenever it changes size.
   *
   * The window is a strip (about 980x150) and the words are a small column inside
   * it. Telling the main process where that column is keeps the invisible margins
   * click-through even when the lyrics themselves are interactive. The toolbar is
   * part of the box on purpose: hiding it with `display:none` would shrink the
   * hit area the moment the pointer moved down towards its buttons.
   */
  useEffect(() => {
    const element = stack.current
    if (!element) return
    const report = () => {
      const rect = element.getBoundingClientRect()
      void bridge.overlay.setHitArea({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height
      })
    }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [size, state.text, state.next, state.title, state.artist, state.playing])

  /*
   * Walk the fill forward locally.
   *
   * The line only crosses the process boundary when it changes, so the position
   * handed over with it is a starting point, not a live value. Running the clock
   * here - ten times a second, straight into a CSS variable - keeps the strip in
   * sync without a second IPC stream.
   */
  useEffect(() => {
    let lastText: string | null = null
    const tick = () => {
      const element = fill.current
      if (!element) return
      const { at, to, position, playing, text } = state
      // A new line restarts from zero without animating backwards from the
      // previous line's full width.
      if (text !== lastText) {
        lastText = text
        element.style.transition = 'none'
        element.style.setProperty('--cut', '100%')
        void element.offsetWidth
        element.style.transition = ''
      }
      if (at === null || to === null || to <= at) {
        // Unsynchronised (or a line with no following timestamp): paint it
        // plainly rather than faking a progress that means nothing.
        element.style.setProperty('--cut', '0%')
      } else {
        const now = playing ? position + (performance.now() - stamp) / 1000 : position
        const ratio = Math.min(1, Math.max(0, (now - at) / (to - at)))
        element.style.setProperty('--cut', `${Math.round((1 - ratio) * 1000) / 10}%`)
      }
    }
    // Anchored once per state push: `stamp` is when that position was read.
    stamp = performance.now()
    const timer = window.setInterval(tick, 100)
    tick()
    return () => window.clearInterval(timer)
  }, [state])

  const setLock = async (next: boolean) => {
    const applied = await bridge.overlay.setLocked(next)
    setLocked(applied)
  }

  const active = hovering || !locked

  const words = state.text ? (
    <>
      <div className="lyric-line">
        <span className="lyric-line__base">{state.text}</span>
        <span ref={fill} className="lyric-line__fill" aria-hidden="true">
          {state.text}
        </span>
      </div>
      {state.next ? <div className="lyric-next">{state.next}</div> : null}
    </>
  ) : state.title ? (
    // Lyrics are not the only useful thing to show: this keeps the strip
    // meaningful for instrumentals and untagged files.
    <div className="lyric-idle">
      {state.playing ? '♪ ' : '❙❙ '}
      {state.title}
      {state.artist ? ` — ${state.artist}` : ''}
    </div>
  ) : (
    <div className="lyric-idle">Aurora 桌面歌词</div>
  )

  return (
    <div className="lyric-layer">
      <div
        ref={stack}
        className={`lyric-stack${locked ? ' is-locked' : ' is-unlocked'}${active ? ' is-active' : ''}`}
        style={{ ['--size' as string]: `${size}px`, ['--accent' as string]: state.accent || '#7d8899' }}
      >
        <div className="lyric-words">{words}</div>

        <div className="lyric-toolbar">
          <span className="lyric-toolbar__transport">
            <button
              className="lyric-tool"
              onClick={() => void bridge.overlay.command('prev')}
              title="上一首"
              aria-label="上一首"
            >
              <Prev size={18} strokeWidth={1.9} />
            </button>
            <button
              className="lyric-tool lyric-tool--key"
              onClick={() => void bridge.overlay.command('toggle')}
              title={state.playing ? '暂停' : '播放'}
              aria-label={state.playing ? '暂停' : '播放'}
            >
              {state.playing ? <Pause size={18} strokeWidth={1.9} /> : <Play size={18} strokeWidth={1.9} />}
            </button>
            <button
              className="lyric-tool"
              onClick={() => void bridge.overlay.command('next')}
              title="下一首"
              aria-label="下一首"
            >
              <Next size={18} strokeWidth={1.9} />
            </button>
          </span>

          <span className="lyric-toolbar__tools">
            <button
              className={`lyric-tool lyric-tool--sm${locked ? ' is-on' : ''}`}
              onClick={() => void setLock(!locked)}
              title={locked ? '解锁位置（解锁后能拖动）' : '锁定位置（锁定后鼠标穿透）'}
              aria-label={locked ? '解锁位置' : '锁定位置'}
            >
              {locked ? <Lock size={15} strokeWidth={1.7} /> : <Unlock size={15} strokeWidth={1.7} />}
            </button>
            <button
              className="lyric-tool lyric-tool--sm"
              onClick={() => void bridge.overlay.close()}
              title="关闭桌面歌词"
              aria-label="关闭桌面歌词"
            >
              <Close size={15} strokeWidth={1.7} />
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

/** When the current state's position was read off the player, in `performance.now()` ms. */
let stamp = 0