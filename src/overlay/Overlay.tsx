import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Close, Lock, Next, Pause, Play, Prev, Unlock } from '../ui/icons'
import { bridge } from '../bridge'
import { splitLyricLine } from '../features/lyrics/line-parts'
import { fitLyricSize, sungColor } from './visual'
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
 * The window is a transparent, always-on-top sheet of text. Three things carry
 * the design, and everything else is scaffolding:
 *
 *  - **the line** is one unbroken sentence. It never wraps (a phrase split over
 *    two lines stops being a phrase) and never shows an ellipsis (an ellipsis
 *    eats the rhyme); it shrinks to fit instead. Contrast comes from a shadow
 *    stack, not from a plate: a rectangle behind the words reads as a rendering
 *    bug on a wallpaper.
 *  - **the fill** is the same line painted again in the artwork accent and
 *    revealed as the line is sung. It is the one thing that distinguishes a
 *    lyric overlay from a subtitle, so it gets the most attention: the accent is
 *    pulled into a legible saturation/lightness band (`sungColor`), the leading
 *    edge is feathered by a soft mask instead of a hard clip, and the line
 *    arrives with a short rise-and-focus animation so crossing a line boundary
 *    looks deliberate.
 *  - **the toolbar** appears only while the pointer is on the strip. It is the
 *    one place with a surface; at rest the words sit directly on the desktop.
 *
 * Three interaction states matter:
 *
 *  - **locked** the window ignores the mouse, so it never eats a click meant for
 *    the app underneath. While the pointer is over the strip the window takes the
 *    mouse back only over the toolbar, which is what makes its buttons reachable
 *    without unlocking;
 *  - **hovered** the pointer is on the strip, so the toolbar fades in;
 *  - **unlocked** the window takes the mouse everywhere it covers, for dragging.
 */
export function Overlay() {
  const [state, setState] = useState<OverlayState>(IDLE)
  const [locked, setLocked] = useState(true)
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [hovering, setHovering] = useState(false)
  /** Size the current line had to be rendered at to fit the window, or null when it fits. */
  const [fitSize, setFitSize] = useState<number | null>(null)
  const stack = useRef<HTMLDivElement | null>(null)
  const toolbar = useRef<HTMLDivElement | null>(null)
  const line = useRef<HTMLDivElement | null>(null)

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

  /*
   * Report the stack's box whenever it changes size.
   *
   * The window is a strip (about 980x160) and the words are a small column inside
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
   * 工具条自己的矩形也要报给主进程。
   *
   * 锁定之后只有这一块会接管鼠标：歌词文字要穿透（否则桌面上的点击被吃掉，
   * 看起来就是「锁了没锁住」），但控制栏得点得到。它用 visibility 隐藏、不改变
   * 布局，所以矩形一直有效。
   */
  useEffect(() => {
    const element = toolbar.current
    if (!element) return
    const report = () => {
      const rect = element.getBoundingClientRect()
      void bridge.overlay.setToolbarArea({
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
  }, [locked, size, state.text, state.next])

  /*
   * Walk the fill forward locally.
   *
   * The line only crosses the process boundary when it changes, so the position
   * handed over with it is a starting point, not a live value. Running the clock
   * here keeps the strip in sync without a second IPC stream.
   *
   * A gradient mask is used rather than `clip-path`, and it needs a real frame
   * clock: at ten steps a second the feathered edge visibly jumps forward in
   * chunks, which reads as stutter rather than singing.
   */
  useEffect(() => {
    /*
     * Written on the line, not on the filled copy: the fill and the bright leading
     * edge are two siblings, and a custom property set on one of them is invisible
     * to the other. The line is their common parent, so both inherit the same
     * value and their masks stay locked to the same edge.
     */
    const element = line.current
    if (!element || !state.text) return
    const { at, to, playing, position } = state
    const paint = (ratio: number) => {
      element.style.setProperty(
        '--progress',
        ratio <= 0 ? '-6%' : ratio >= 1 ? '140%' : `${(ratio * 100).toFixed(2)}%`
      )
    }
    if (at === null || to === null || to <= at) {
      // Unsynchronised lyrics: paint the line plainly. Faking a progress that
      // means nothing is worse than showing none.
      paint(0)
      return
    }
    if (!playing) {
      paint((position - at) / (to - at))
      return
    }
    const anchor = performance.now()
    let frame = 0
    const step = () => {
      const now = position + (performance.now() - anchor) / 1000
      const ratio = (now - at) / (to - at)
      paint(ratio)
      // Stop at the end of the line instead of spinning until the next push.
      if (ratio < 1) frame = requestAnimationFrame(step)
    }
    step()
    return () => cancelAnimationFrame(frame)
  }, [state])

  /*
   * Shrink the line to the window.
   *
   * Measured against the rendered element rather than estimated from character
   * counts: mixed Chinese and Latin text has no useful per-character width, and a
   * wrong estimate either clips the last character or shrinks a short line for no
   * reason. The percentage the fill uses is relative to this same element, so the
   * two copies stay aligned whatever size the line ends up at.
   */
  useLayoutEffect(() => {
    const element = line.current
    if (!element || !state.text) {
      setFitSize(null)
      return
    }
    const measure = () => {
      // Ask for the base size first: a previous line's shrink must not be
      // inherited by this one.
      element.style.setProperty('--line-size', `${size}px`)
      /*
       * scrollWidth, not offsetWidth. The line is `max-width: 100%`, so its box
       * stops at the window edge and offsetWidth would report the clamped box -
       * a long line then looks like it fits and is clipped instead of shrunk.
       * scrollWidth keeps reporting the width the text actually wants.
       */
      const measured = element.scrollWidth
      const available = Math.max(240, window.innerWidth - 48)
      setFitSize(Math.round(fitLyricSize(size, measured, available) * 2) / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [size, state.text])

  const setLock = async (next: boolean) => {
    const applied = await bridge.overlay.setLocked(next)
    setLocked(applied)
  }

  /*
   * 解锁：一直显示控制条；锁定：默认收起，鼠标进到这条带时再浮出来——那颗锁
   * 按钮在锁定态就藏在这里，不显示它就没法解锁。
   */
  useEffect(() => bridge.overlay.onHover(setHovering), [])
  const active = !locked || hovering

  /*
   * 译文与原文分开两行，和舞台、播放页用同一个判据。
   *
   * 上游把译文用「 / 」接在原文后面（见 features/netease/lrc.ts 的
   * mergeTranslation），整条挤在一行时英文占满宽度、中文被折到下一行，看起来像
   * 两段无关的字。桌面歌词窗口只有一句话的位置，更不能把两种语言叠在同一处：
   * 原文照常渐亮，译文以小一号的字贴在下面。
   */
  const lineParts = splitLyricLine(state.text ?? '')
  const nextParts = splitLyricLine(state.next ?? '')
  const idleTitle = state.title || 'Aurora 桌面歌词'

  return (
    <div className="lyric-layer">
      <div
        ref={stack}
        className={`lyric-stack${locked ? ' is-locked' : ' is-unlocked'}${active ? ' is-active' : ''}${
          state.playing ? '' : ' is-paused'
        }`}
        style={{
          ['--size' as string]: `${size}px`,
          ['--accent' as string]: state.accent || '#7d8899',
          ['--fill' as string]: sungColor(state.accent)
        }}
      >
        <div className="lyric-words">
          {/* Re-keyed per line: the arrival animation is a remount, not a class toggle. */}
          <div className="lyric-current" key={state.text ?? `idle:${idleTitle}`}>
            {state.text ? (
              <>
                <div className="lyric-line" ref={line} style={{ ['--line-size' as string]: `${fitSize ?? size}px` }}>
                  <span className="lyric-line__base">{lineParts.main}</span>
                  <span className="lyric-line__fill" aria-hidden="true">
                    {lineParts.main}
                  </span>
                  <span className="lyric-line__lead" aria-hidden="true">
                    {lineParts.main}
                  </span>
                </div>
                {lineParts.sub ? <div className="lyric-line__sub">{lineParts.sub}</div> : null}
              </>
            ) : (
              // Lyrics are not the only useful thing to show: this keeps the strip
              // meaningful for instrumentals and untagged files.
              <div className="lyric-idle">
                <span className="lyric-idle__note" aria-hidden="true">
                  {state.playing ? '♪' : '❙❙'}
                </span>
                <span className="lyric-idle__title">{idleTitle}</span>
                {state.artist ? <span className="lyric-idle__artist">{state.artist}</span> : null}
              </div>
            )}
          </div>
          {state.text && nextParts.main ? <div className="lyric-next">{nextParts.main}</div> : null}
        </div>

        <div className="lyric-toolbar" ref={toolbar}>
          <span className="lyric-toolbar__transport">
            <button
              className="lyric-tool"
              onClick={() => void bridge.overlay.command('prev')}
              title="上一首"
              aria-label="上一首"
            >
              <Prev size={17} strokeWidth={1.9} />
            </button>
            <button
              className="lyric-tool lyric-tool--key"
              onClick={() => void bridge.overlay.command('toggle')}
              title={state.playing ? '暂停' : '播放'}
              aria-label={state.playing ? '暂停' : '播放'}
            >
              {state.playing ? <Pause size={17} strokeWidth={1.9} /> : <Play size={17} strokeWidth={1.9} />}
            </button>
            <button
              className="lyric-tool"
              onClick={() => void bridge.overlay.command('next')}
              title="下一首"
              aria-label="下一首"
            >
              <Next size={17} strokeWidth={1.9} />
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
