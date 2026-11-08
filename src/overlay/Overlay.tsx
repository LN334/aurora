import { useEffect, useRef, useState } from 'react'
import { Close, Lock, Minus, Plus, Unlock } from '../ui/icons'
import { bridge } from '../bridge'
import type { OverlayState } from '../env'

/** Font size is a property of this window, so it lives in its own storage. */
const SIZE_KEY = 'aurora.desktopLyrics.size'
const MIN_SIZE = 18
const MAX_SIZE = 64
const DEFAULT_SIZE = 34

const IDLE: OverlayState = { text: null, next: null, title: '', artist: '', playing: false }

/**
 * The desktop lyric strip.
 *
 * Renders in its own transparent, always-on-top window. Three states matter:
 *
 *  - **locked** the window ignores the mouse, so it never eats a click meant
 *    for the app underneath. While the pointer is over the lyrics the window
 *    takes the mouse back, which is what makes the buttons reachable without
 *    unlocking first;
 *  - **hovered** the pointer is on the strip - the control rail fades in so it
 *    is obvious the thing can be operated; the words keep only their own halo;
 *  - **unlocked** the window takes the mouse everywhere it covers, for dragging
 *    it around deliberately.
 */
export function Overlay() {
  const [state, setState] = useState<OverlayState>(IDLE)
  const [locked, setLocked] = useState(true)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [hovering, setHovering] = useState(false)
  const plate = useRef<HTMLDivElement | null>(null)

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
      void bridge.overlay.setSize(Math.min(MAX_SIZE, Math.max(MIN_SIZE, legacy)))
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
   * Report the plate's box whenever it changes size.
   *
   * The window is a strip (about 980x150) and the words are a small box inside
   * it. Telling the main process where that box is means the invisible margins
   * stay click-through even when the lyrics themselves are interactive.
   */
  useEffect(() => {
    const element = plate.current
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
  }, [size, state.text, state.next, state.title])

  const applySize = (next: number) => {
    const clamped = Math.min(MAX_SIZE, Math.max(MIN_SIZE, next))
    setSize(clamped)
    void bridge.overlay.setSize(clamped)
  }

  const setLock = async (next: boolean) => {
    const applied = await bridge.overlay.setLocked(next)
    setLocked(applied)
  }

  const active = hovering || !locked

  return (
    <div className="stage-lyric__wrap">
      <div
        ref={plate}
        className={`stage-lyric${locked ? ' is-locked' : ' is-unlocked'}${active ? ' is-active' : ''}`}
        style={{ ['--lyric-size' as string]: `${size}px` }}
      >
        <div className="stage-lyric__body">
          {state.text ? (
            <>
              <div className="stage-lyric__line">{state.text}</div>
              {state.next ? <div className="stage-lyric__next">{state.next}</div> : null}
            </>
          ) : state.title ? (
            // Lyrics are not the only useful thing to show: this keeps the strip
            // meaningful for instrumentals and untagged files.
            <div className="stage-lyric__idle">
              {state.playing ? '♪ ' : '❙❙ '}
              {state.title}
              {state.artist ? ` — ${state.artist}` : ''}
            </div>
          ) : (
            <div className="stage-lyric__idle">Aurora 桌面歌词</div>
          )}
        </div>

        {/* 竖排右侧，不压歌词行；静止时整条隐去，悬停才浮出。 */}
        <div className="stage-lyric__controls">
          <button
            className="stage-lyric__button"
            data-label="缩小"
            onClick={() => applySize(size - 2)}
            disabled={size <= MIN_SIZE}
            title="缩小字号"
            aria-label="缩小字号"
          >
            <Minus size={14} />
          </button>
          <button
            className="stage-lyric__button"
            data-label="放大"
            onClick={() => applySize(size + 2)}
            disabled={size >= MAX_SIZE}
            title="放大字号"
            aria-label="放大字号"
          >
            <Plus size={14} />
          </button>
          <button
            className="stage-lyric__button stage-lyric__button--lock"
            data-label={locked ? '锁定中' : '已解锁'}
            data-locked={locked}
            aria-pressed={locked}
            onClick={() => void setLock(!locked)}
            title={locked ? '解锁：一直可以拖动和点按' : '锁定：鼠标穿透，不挡下面的窗口'}
            aria-label={locked ? '解锁桌面歌词' : '锁定桌面歌词'}
          >
            {locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button
            className="stage-lyric__button"
            data-label="关闭"
            onClick={() => void bridge.overlay.close()}
            title="关闭桌面歌词"
            aria-label="关闭桌面歌词"
          >
            <Close size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
