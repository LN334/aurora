import { useCallback, useEffect, useRef } from 'react'
import { isWindowVisible } from './engine'
import { usePlayer } from './store'

/**
 * Resolution at which the transport chrome reads the playhead.
 *
 * One eighth of a second. The reason is geometric: a seek bar is a few hundred
 * pixels wide, so an eighth of a second moves it by far less than a pixel on
 * anything longer than half a minute (a 200 s track on a 600 px bar moves 0.4 px
 * per step; a 30 s track, the worst realistic case, moves 2.5 px at 8 Hz while
 * the knob itself travels 20 px/s, which still reads as motion, not as stepping).
 *
 * Why it matters: zustand compares the selector result with `Object.is`, so
 * quantising here collapses sixty store notifications per second into one
 * re-render per *visible* change. The bar, its knob and the elapsed-time text
 * are then written ~8 times a second instead of ~60, and every one of those
 * writes is sub-pixel.
 *
 * What deliberately does *not* use this: the lyric highlight. A line has to
 * appear within a frame of its timestamp, so `LyricColumn` keeps reading the raw
 * position; that subscription costs nothing because its selector returns a line
 * index and therefore only re-renders at line boundaries.
 */
const PROGRESS_STEP_SECONDS = 1 / 8

/** Playhead position, quantised to {@link PROGRESS_STEP_SECONDS}. */
export function useProgressPosition(): number {
  return usePlayer((state) => {
    /*
     * While the window is not on screen, report one fixed value.
     *
     * The engine already drops to a 250 ms timer when the window is hidden, but
     * "less often" is not "never": measured, a hidden Electron window still made
     * ~17 DOM writes a second, all of them to a seek bar nobody can see. Returning
     * a constant means zustand's `Object.is` comparison finds no change, so the
     * notification stops at the store instead of reaching React.
     *
     * Coming back needs no resync: re-showing the window publishes a visibility
     * change, which re-renders this component, which then reads the live position.
     */
    if (!isWindowVisible()) return 0
    return Math.round(state.position / PROGRESS_STEP_SECONDS) * PROGRESS_STEP_SECONDS
  })
}

interface BarProps {
  /** Playhead position, 0..1. */
  value: number
  onChange: (value: number) => void
  ariaLabel: string
  disabled?: boolean
  className?: string
  /** 读屏与悬停提示用的可读值（音量条给「85%」）。 */
  valueText?: string
  /** 鼠标滚轮：+1 表示调大（向上滚），-1 表示调小。传了才接管滚轮。 */
  onWheelDelta?: (direction: number) => void
  /**
   * 竖向：音量用。0 在底部，拖动按 clientY 反算。
   *
   * 播放页那颗音量键悬停时浮出来的是一条竖条——横向滑条在那儿会顶到歌名，
   * 竖向只占一个按键的宽。
   */
  vertical?: boolean
}

/**
 * A scrubbable horizontal bar. Uses pointer capture so a drag that leaves the
 * element (which is what happens whenever you drag a seek bar) keeps tracking,
 * and exposes the slider role so keyboard and screen readers work too.
 */
export function Bar({
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
  valueText,
  onWheelDelta,
  vertical = false
}: BarProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  /*
   * 滚轮用原生监听而不是 React 的 onWheel：React 把 wheel 挂在根节点上时是
   * passive 的，preventDefault 会被忽略，页面会跟着一起滚。
   */
  const wheelHandler = useRef(onWheelDelta)
  wheelHandler.current = onWheelDelta
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY || !wheelHandler.current) return
      event.preventDefault()
      // 向上滚（deltaY 为负）是「调大」，符合音量旋钮的方向感。
      wheelHandler.current(-Math.sign(event.deltaY))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  const pct = Math.min(1, Math.max(0, value)) * 100

  const seekTo = useCallback(
    (clientX: number, clientY: number) => {
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (vertical) {
        if (rect.height <= 0) return
        // 竖条上端是满，下端是零。
        onChange(Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height)))
        return
      }
      if (rect.width <= 0) return
      onChange(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
    },
    [onChange, vertical]
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      event.currentTarget.setPointerCapture(event.pointerId)
      seekTo(event.clientX, event.clientY)
    },
    [disabled, seekTo]
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      seekTo(event.clientX, event.clientY)
    },
    [disabled, seekTo]
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const step = event.shiftKey ? 0.1 : 0.02
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault()
        onChange(Math.min(1, value + step))
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault()
        onChange(Math.max(0, value - step))
      } else if (event.key === 'Home') {
        event.preventDefault()
        onChange(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        onChange(1)
      }
    },
    [disabled, onChange, value]
  )

  return (
    <div
      ref={rootRef}
      className={['bar', vertical ? 'is-vertical' : '', className ?? ''].filter(Boolean).join(' ')}
      role="slider"
      title={valueText}
      aria-valuetext={valueText}
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div className="bar__track" ref={trackRef}>
        <div className="bar__fill" style={vertical ? { height: `${pct}%` } : { width: `${pct}%` }} />
        <div className="bar__knob" style={vertical ? { bottom: `${pct}%` } : { left: `${pct}%` }} />
      </div>
    </div>
  )
}
