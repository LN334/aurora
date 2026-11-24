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
  words: [],
  accent: ''
}

/**
 * 这一句唱到第几个字了，0..1。
 *
 * 逐字时间只知道「每个字什么时候开口」，不知道它什么时候收声，所以一个字占的
 * 时间算到下一个字开口为止；最后一个字用行尾兜住。取不到逐字时退回行级匀速，
 * 和以前一模一样。
 *
 * 横向位置优先用测出的词框（见下面的 useLayoutEffect）：字宽不等，按字数摊
 * 会把边界画在还没唱的字上。量不到时（字体未就绪、词与行文对不齐）才退回
 * 整行按时间线性——有时间误差，至少不会指错字。
 */
function sungFill(
  now: number,
  words: OverlayState['words'],
  boxes: { left: number; width: number }[],
  at: number,
  to: number,
  width: number
): number {
  const parts = words ?? []
  const span = to - at
  const fallback = () => (span > 0 ? Math.min(1, Math.max(0, (now - at) / span)) * width : width)
  if (parts.length === 0 || span <= 0) return fallback()
  /*
   * 末词没有「下一个词」当结束时间，而行尾是下一句开口，中间常隔着一整段间奏。
   * 拿行尾兜底会让末词拖十几秒都唱不完，所以按常规词时估一个收声点。
   */
  let typical = span / parts.length
  if (parts.length > 1) {
    let sum = 0
    for (let index = 1; index < parts.length; index += 1) sum += parts[index].at - parts[index - 1].at
    typical = sum / (parts.length - 1)
  }
  const tail = Math.min(to, parts[parts.length - 1].at + Math.max(0.12, typical * 1.5))
  if (now >= tail) return width
  if (now <= at) return 0
  let index = parts.length - 1
  for (let candidate = 0; candidate < parts.length; candidate += 1) {
    const edge = candidate + 1 < parts.length ? parts[candidate + 1].at : tail
    if (now < edge) {
      index = candidate
      break
    }
  }
  const start = parts[index].at
  const edge = index + 1 < parts.length ? parts[index + 1].at : tail
  const inside = edge > start ? Math.min(1, Math.max(0, (now - start) / (edge - start))) : 1
  const box = boxes[index]
  if (!box || boxes.length !== parts.length) return fallback()
  return box.left + box.width * inside
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
  /* 每个词在行里的横向位置（px，相对行首）。逐字时间只给「第几个词」，像素得量。 */
  const boxes = useRef<{ left: number; width: number }[]>([])

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
    const { at, to, playing, position, words } = state
    /*
     * 进度写成 px，不是百分比。
     *
     * 百分比是相对整行宽度的，而字宽不等：i 只有 w 的四分之一，英文歌词里按字数
     * 推进的边界会跑到还没唱的字上。每个词的宽度由量出的词框决定。
     */
    const paint = (px: number) => {
      element.style.setProperty('--progress', px <= 0 ? '-40px' : px.toFixed(2) + 'px')
    }
    if (at === null || to === null || to <= at) {
      // Unsynchronised lyrics: paint the line plainly. Faking a progress that
      // means nothing is worse than showing none.
      paint(0)
      return
    }
    const width = element.getBoundingClientRect().width
    const fill = (now: number) => sungFill(now, words, boxes.current, at, to, width)
    if (!playing) {
      paint(fill(position))
      return
    }
    const anchor = performance.now()
    let frame = 0
    const step = () => {
      const now = position + (performance.now() - anchor) / 1000
      const px = fill(now)
      paint(px)
      // Stop at the end of the line instead of spinning until the next push.
      if (px < width) frame = requestAnimationFrame(step)
    }
    step()
    return () => cancelAnimationFrame(frame)
  }, [state])

  /*
   * 每个词在行里的横向位置。
   *
   * 不往行里插 span：那会改变字距（inline 元素之间多出空白），而且 fill/lead
   * 两个副本还得各量一遍。直接用 Range 在文本节点上取矩形，DOM 不动。
   */
  useLayoutEffect(() => {
    const element = line.current
    const node = element?.querySelector('.lyric-line__base')?.firstChild
    const words = state.words ?? []
    /* 先清掉上一行的框：新行量不出来时不能沿用旧边界。 */
    boxes.current = []
    if (!element || !node || node.nodeType !== Node.TEXT_NODE || words.length === 0) return
    const text = node.textContent ?? ''
    /*
     * 词拼起来必须与这一行一模一样，否则「第几个词的框」对不上文本位置。
     * 差一个字就会让 Range 越界抛错——那会卸掉整棵组件树，桌面歌词直接空白。
     */
    const total = words.reduce((sum, word) => sum + word.text.length, 0)
    if (total !== text.length) return
    const measure = () => {
      try {
        const base = element.getBoundingClientRect()
        const range = document.createRange()
        const next: { left: number; width: number }[] = []
        let offset = 0
        for (const word of words) {
          const stop = Math.min(text.length, offset + word.text.length)
          if (stop <= offset) return
          range.setStart(node, offset)
          range.setEnd(node, stop)
          const box = range.getBoundingClientRect()
          next.push({ left: box.left - base.left, width: box.width })
          offset = stop
        }
        boxes.current = offset === text.length ? next : []
      } catch {
        /* 量不到就退回整行比例：边界略偏，总好过整页不显示。 */
        boxes.current = []
      }
    }
    measure()
    // 字体是异步换上的：换完字宽会变，不重量一次边界会错半句。
    void document.fonts.ready.then(measure).catch(() => undefined)
  }, [state.text, state.words, size, fitSize])

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
