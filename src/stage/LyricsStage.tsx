import { activeLineAt, type Lyrics } from '../features/lyrics/lrc'
import type { Palette } from '../features/library/palette'
import type { Track } from '../types'
import { useProgressPosition } from '../features/player/Bar'
import { formatTime } from '../ui/format'
import { AlbumName, ArtistName } from '../ui/NameRef'
import { ChevronLeft, Locate, Note, Next, Pause, Play, Prev, Volume, VolumeMute } from '../ui/icons'
import { Artwork } from '../ui/Artwork'
import { artworkFor } from '../features/library/source'
import { usePlayer } from '../features/player/store'
import { splitLyricLine } from '../features/lyrics/line-parts'
import { player } from '../features/player/actions'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Visualizer } from './Visualizer'
import { chooseEntry } from '../features/wallpaper/pure'
import { StageParticles } from './StageParticles'
import { useWallpaper } from '../features/wallpaper/store'

/** Lines shown above and below the active one. Fixed, so centring is exact. */
const SPAN = 4
const SLOTS = SPAN * 2 + 1

interface LyricColumnProps {
  lyrics: Lyrics
  /** 手动钉住的行号；null = 跟着正在唱的那句走。 */
  pinned: number | null
  onPin(next: number | null): void
  onSeek(seconds: number): void
}

function LyricColumn({ lyrics, pinned, onPin, onSeek }: LyricColumnProps) {
  const active = usePlayer((state) => activeLineAt(lyrics.lines, state.position))
  const live = active < 0 ? 0 : active
  const last = Math.max(0, lyrics.lines.length - 1)

  const listRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const slotRefs = useRef<(HTMLDivElement | null)[]>([])
  const posRef = useRef(0)
  const velRef = useRef(0)
  const aimRef = useRef(0)
  const baseRef = useRef(0)
  const hRef = useRef(96)
  const dragRef = useRef<{ id: number; y: number; base: number; moved: boolean } | null>(null)
  /*
   * 内容也由帧循环直写，React 只在挂载时渲染九个空槽。
   *
   * 旧版把整列内容放在 JSX 里，跨行时 setState 会让九个槽同时换文本节点：
   * 那一帧既掉帧，译文 span 又会先被拆掉再插回来，看起来就是「抽一下、译文
   * 闪没」。现在 DOM 结构从挂载到卸载不变，只改 textContent 和 class。
   */
  const paintedRef = useRef(-1)
  const classRef = useRef<string[]>([])

  const liveRef = useRef(live)
  const lastRef = useRef(last)
  const linesRef = useRef(lyrics.lines)
  const activeRef = useRef(active)
  liveRef.current = live
  lastRef.current = last
  linesRef.current = lyrics.lines
  activeRef.current = active

  /*
   * 手动翻看。
   *
   * `pinned` 是舞台持有的行号（拖动、滚轮改它），null 表示跟着正在唱的那句。
   * 这里只负责「把画面挪到那个位置」——上下拖动、停手六秒自动交还，都在舞台和
   * 底栏那颗「回到正在唱」上。
   */
  if (!dragRef.current) {
    aimRef.current = Math.max(0, Math.min(last, pinned === null ? live : pinned))
  }

  /* 换歌：从跟着播放的位置重新出发，别把上一首的行号带到这一首身上 */
  useEffect(() => {
    const seat = Math.max(0, Math.min(lastRef.current, liveRef.current))
    posRef.current = seat
    velRef.current = 0
    baseRef.current = Math.round(seat)
    paintedRef.current = -1
    classRef.current = []
  }, [lyrics.lines])

  /*
   * 槽高由 CSS 变量给，窗口一变就换一套值，量一次不够用。
   *
   * 必须量布局高度（offsetHeight）：.lyr 自身带 scale，getBoundingClientRect
   * 拿到的是缩放后的 44%–100%，拿它当槽高会让整列只滚了不到一半的距离，
   * 顶端几行就顶出画面。
   */
  useEffect(() => {
    const read = (): void => {
      const node = trackRef.current?.firstElementChild as HTMLElement | null
      if (!node) return
      const height = node.offsetHeight
      if (height > 0) hRef.current = height
    }
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  /* 把「以 centre 为中行」的九行写进固定槽位。只动 textContent 与 class。 */
  function paint(centre: number): void {
    const lines = linesRef.current
    for (let i = 0; i < SLOTS; i += 1) {
      const node = slotRefs.current[i]
      const button = node?.firstElementChild as HTMLButtonElement | null
      if (!node || !button) continue
      const main = button.children[0] as HTMLElement
      const sub = button.children[1] as HTMLElement
      const index = centre - SPAN + i
      const line = lines[index]
      if (!line) {
        button.dataset.index = ''
        button.classList.add('lyr__text--empty')
        main.textContent = ''
        sub.textContent = ''
        sub.style.display = 'none'
        button.removeAttribute('title')
        continue
      }
      const parts = splitLyricLine(line.text || '·')
      button.dataset.index = String(index)
      button.classList.remove('lyr__text--empty')
      main.textContent = parts.main
      sub.textContent = parts.sub || ''
      sub.style.display = parts.sub ? '' : 'none'
      button.title = '跳到 ' + formatTime(line.time)
    }
  }

  /*
   * 谁在唱、谁待唱：每帧对一遍，变了才写 class。
   *
   * 走帧循环而不是 JSX，是为了让「正在唱」的切换和位移落在同一帧——以前
   * setState 晚一帧，高亮追着字跑，看起来就是抽搐。
   */
  function paintState(centre: number): void {
    const activeNow = activeRef.current
    const lines = linesRef.current
    for (let i = 0; i < SLOTS; i += 1) {
      const node = slotRefs.current[i]
      if (!node) continue
      const index = centre - SPAN + i
      const isActive = activeNow >= 0 && index === activeNow
      const isPending = activeNow < 0 && i === SPAN && Boolean(lines[index])
      const next = isActive ? 'lyr is-active' : isPending ? 'lyr is-pending' : 'lyr'
      if (classRef.current[i] === next) continue
      classRef.current[i] = next
      node.className = next
    }
  }

  /*
   * 每帧推进。
   *
   * 欠阻尼弹簧：拨一下会先冲过一格再被拉回来，停手才收住——这就是「有动画」和
   * 「跳一格」的差别。整列位移是连续的，跨行时内容按整行换、位移补上半格，两件
   * 事叠在一起看，就是一路滑过去，而不是一格一格闪。
   */
  useEffect(() => {
    let raf = 0
    let clock = 0
    const tick = (now: number): void => {
      const previous = clock || now
      clock = now
      const dt = Math.min(0.05, Math.max(0.004, (now - previous) / 1000))
      const height = hRef.current
      if (!dragRef.current) {
        const gap = aimRef.current - posRef.current
        if (Math.abs(gap) < 0.002 && Math.abs(velRef.current) < 0.02) {
          posRef.current = aimRef.current
          velRef.current = 0
        } else {
          velRef.current += (gap * 170 - velRef.current * 13) * dt
          posRef.current += velRef.current * dt
        }
      }
      const pos = Math.max(0, Math.min(lastRef.current, posRef.current))
      const centred = Math.round(pos)
      if (centred !== paintedRef.current) {
        paintedRef.current = centred
        paint(centred)
      }
      /*
       * 内容在整行上，画面在小数上：两者相加才是连续滚动。
       * 轨道是绝对定位的，得自己把「容器中心」补上，否则整列会顶到画面上沿。
       */
      const track = trackRef.current
      if (track) {
        const shift = (centred - pos) * height
        const half = track.parentElement ? track.parentElement.clientHeight / 2 : 0
        track.style.transform =
          'translate3d(0,' + (half - (SPAN + 0.5) * height + shift).toFixed(2) + 'px,0)'
      }
      const delta = pos - centred
      for (let i = 0; i < SLOTS; i += 1) {
        const node = slotRefs.current[i]
        if (!node) continue
        const far = Math.abs(i - SPAN - delta)
        /* 只写到两位小数：连续的远近距离没必要每帧刷新一次样式 */
        const coarse = Math.round(far * 40)
        if (node.dataset.far === String(coarse)) continue
        node.dataset.far = String(coarse)
        node.style.setProperty('--far', (coarse / 40).toFixed(3))
      }
      paintState(centred)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  /*
   * 滚轮翻行。必须是非被动监听：舞台自己不该滚，但外层容器会跟着滚一下。
   * 一次滚最多两行——触控板的惯性 delta 能到几百，照搬会直接甩出去。
   */
  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.deltaY) return
      event.preventDefault()
      const from = pinned === null ? live : pinned
      const step = Math.max(-2, Math.min(2, event.deltaY / 120))
      onPin(Math.max(0, Math.min(last, Math.round(from + step))))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [pinned, live, last, onPin])

  /*
   * 拖动换行。
   *
   * 只有移动超过 6px 才抢指针：抢早了，点某一句跳过去的 click 会落到容器上。
   * 拖动过程中直接改位置（跟手），松手才把「停在那一行」交回去，让弹簧吸过去。
   */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const from = pinned === null ? live : pinned
    dragRef.current = {
      id: event.pointerId,
      y: event.clientY,
      base: Math.max(0, Math.min(last, from)),
      moved: false
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const dy = event.clientY - drag.y
    if (!drag.moved) {
      if (Math.abs(dy) <= 6) return
      drag.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.classList.add('is-drag')
    }
    posRef.current = Math.max(0, Math.min(last, drag.base - dy / hRef.current))
    velRef.current = 0
  }
  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    event.currentTarget.classList.remove('is-drag')
    if (!drag.moved) return
    onPin(Math.round(posRef.current))
  }

  return (
    <div
      className="stage__lyrics"
      role="list"
      aria-live="off"
      ref={listRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="stage__lyrics-track" ref={trackRef}>
        {/* 九个固定槽位：内容由帧循环直写，React 挂载后不再碰这里 */}
        {Array.from({ length: SLOTS }, (_, i) => (
          <div
            key={i}
            role="listitem"
            className="lyr"
            ref={(node) => {
              slotRefs.current[i] = node
            }}
          >
            <button
              type="button"
              className="lyr__text"
              onClick={(event) => {
                const index = Number(event.currentTarget.dataset.index)
                const line = lyrics.lines[index]
                if (line) onSeek(line.time)
              }}
            >
              <span className="lyr__main" />
              <span className="lyr__sub" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Small enough that a per-frame re-render costs nothing - and it no longer gets
 * one. The position comes back quantised to an eighth of a second (see
 * `useProgressPosition`), which is a fifth of a pixel of travel on this line,
 * so the fill is written ~8 times a second instead of ~60 while still moving
 * smoothly.
 */
function StageProgress({
  duration,
  onSeekRatio
}: {
  duration: number
  onSeekRatio(ratio: number): void
}) {
  const position = useProgressPosition()
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0

  return (
    <div className="stage__progress">
      <span className="stage__time">{formatTime(position)}</span>
      <div
        className="stage__track"
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          if (rect.width <= 0) return
          onSeekRatio((event.clientX - rect.left) / rect.width)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') onSeekRatio(Math.min(1, ratio + 0.02))
          else if (event.key === 'ArrowLeft') onSeekRatio(Math.max(0, ratio - 0.02))
        }}
      >
        <div className="stage__track-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="stage__time">{formatTime(duration)}</span>
    </div>
  )
}

interface LyricsStageProps {
  track: Track | null
  lyrics: Lyrics
  duration: number
  playing: boolean
  palette: Palette
  getSpectrum: () => Uint8Array | null
  /** Whether online lyric lookup is allowed, so the empty state can offer it. */
  onlineEnabled: boolean
  onEnableOnline(): void
  onSeek(seconds: number): void
  onSeekRatio(ratio: number): void
  onToggle(): void
  /** 退场中：.stage 挂 is-closing 播淡出，320ms 后由父级卸载。 */
  closing?: boolean
  onClose(): void
}

export function LyricsStage({
  track,
  lyrics,
  duration,
  playing,
  palette,
  getSpectrum,
  onlineEnabled,
  onEnableOnline,
  onSeek,
  onSeekRatio,
  onToggle,
  closing = false,
  onClose
}: LyricsStageProps) {

  /*
   * 手动翻看歌词时钉住的行号；null = 跟着正在唱的那句走。
   * 放在舞台这一层，「回到正在唱」才能挂到底栏上方，而不是缩在歌词容器角上。
   */
  const [pinned, setPinned] = useState<number | null>(null)

  // 换歌词就交还给歌曲，免得上一首钉住的行号落到这一首身上。
  useEffect(() => {
    setPinned(null)
  }, [lyrics.lines])

  // 停手 6 秒自己回去；不等这个按钮。
  useEffect(() => {
    if (pinned === null) return
    const timer = window.setTimeout(() => setPinned(null), 6000)
    return () => window.clearTimeout(timer)
  }, [pinned])

  /*
   * 沉浸页用和外壳同一张壁纸。
   *
   * 两条背景路径互斥：极光带是「没有壁纸时」的背景，壁纸开着的时候它会把
   * 壁纸整个盖掉 —— 那正是用户说的「播放页也得接上壁纸」。所以壁纸优先，
   * 极光带让位，而不是两层叠在一起。
   *
   * 封面主色仍然要用上：壁纸之上压一层极淡的封面色调（见 CSS 的 ::after），
   * 否则换歌时整块背景和这首歌没有任何关系。
   */
  const wallpaperEnabled = useWallpaper((state) => state.enabled)
  const wallpaperSelection = useWallpaper((state) => state.selection)
  const wallpaperInfo = useWallpaper((state) => state.info)
  const wallpaperList = useWallpaper((state) => state.list)
  const wallpaperStrength = useWallpaper((state) => state.strength)
  const wallpaper = chooseEntry({
    enabled: wallpaperEnabled,
    selection: wallpaperSelection,
    info: wallpaperInfo,
    list: wallpaperList
  })

  /*
   * 换歌和音量留在这个页面上。
   *
   * 原来的底栏只有一个播放键：想换下一首必须退出沉浸页，回到队列再点一次。
   * 这两个值是播放器的全局状态，订阅它们不会跟着进度条每秒重渲染。
   */
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)

  return (
    <div
      className={[
        'stage',
        wallpaper ? 'stage--wallpaper' : '',
        closing ? 'is-closing' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      // --wp-level 同时喂给壁纸的遮罩和舞台自己的渐变，和外壳用的是同一个值。
      style={
        wallpaper
          ? ({ '--wp-level': String(wallpaperStrength), '--stage-tint': palette.colors[0] } as CSSProperties)
          : undefined
      }
    >
      {wallpaper ? null : <Visualizer getSpectrum={getSpectrum} palette={palette} />}
      <StageParticles palette={palette} />

      <header className="stage__top">
        <button className="stage__back" onClick={onClose} aria-label="退出沉浸模式">
          <ChevronLeft size={18} />
          <span>退出</span>
        </button>
        {/*
          * 歌名放在这里，而不是只藏在歌词里。
          *
          * 歌词第一行常常是「作词 : …」「作曲 : …」，而且没有歌词时整页只剩
          * 一个「没有歌词」——用户当时根本认不出在放哪首歌。
          */}
        <div className="stage__meta">
          {track ? (
            <>
              <span className="stage__kicker">正在播放</span>
              <h1 className="stage__title" title={track.title}>
                {track.title}
              </h1>
              <p className="stage__sub">
                <span className="stage__artist">
                  <ArtistName track={track} />
                </span>
                {track.album ? (
                  <>
                    <span className="stage__sep" aria-hidden="true">
                      ·
                    </span>
                    <span className="stage__album">
                      <AlbumName track={track} />
                    </span>
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <span className="stage__artist">没有在播放</span>
          )}
        </div>

      </header>

      {lyrics.empty ? (
        <div className="stage__lyrics stage__lyrics--empty">
          <div className="stage__nolyrics">
            {/* 没有歌词时至少让人认出是哪首歌：封面 + 歌名。 */}
            {track ? (
              <div className="stage__cover">
                <Artwork src={artworkFor(track)} alt="" fallback={<Note size={30} />} />
              </div>
            ) : null}
            {track ? <p className="stage__nolyrics-title">{track.title}</p> : null}
            <p className="stage__nolyrics-note">这首歌没有可显示的歌词。</p>

            {onlineEnabled ? null : (
              <>
                <button className="btn stage__nolyrics-action" onClick={onEnableOnline}>
                  在线搜索
                </button>
                {/* The one place a lyric lookup leaves the machine, so the
                    consequence is stated before the switch, not after. Kept to
                    one line on purpose. */}
                <p className="stage__nolyrics-hint">会把歌名和艺术家发送到 lrclib.net</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <LyricColumn lyrics={lyrics} pinned={pinned} onPin={setPinned} onSeek={onSeek} />
      )}

      <footer className="stage__bottom">
        <div className="stage__controls">
          <button
            className="stage__ctrl"
            onClick={() => player.prev()}
            disabled={!track}
            aria-label="上一首"
            title="上一首"
          >
            <Prev size={18} />
          </button>
          <button
            className="stage__play"
            onClick={onToggle}
            disabled={!track}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? <Pause size={22} /> : <Play size={22} />}
          </button>
          <button
            className="stage__ctrl"
            onClick={() => player.next()}
            disabled={!track}
            aria-label="下一首"
            title="下一首"
          >
            <Next size={18} />
          </button>
        </div>

        <StageProgress duration={duration} onSeekRatio={onSeekRatio} />

        <div className="stage__vol">
          <button
            type="button"
            className="stage__mute"
            onClick={() => player.toggleMute()}
            aria-label={muted ? '取消静音' : '静音'}
            title={muted ? '取消静音' : '静音'}
          >
            {muted || volume === 0 ? <VolumeMute size={16} /> : <Volume size={16} />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round((muted ? 0 : volume) * 100)}
            aria-label="音量"
            onChange={(event) => player.setVolume(Number(event.target.value) / 100)}
          />
        </div>

        {/* 翻走歌词之后唯一要做的事：回到正在唱的那句。挨着底栏，视线一带就到。 */}
        {pinned !== null ? (
          <button type="button" className="stage__back-live" onClick={() => setPinned(null)}>
            <Locate size={16} />
            <span>回到正在唱</span>
          </button>
        ) : null}
      </footer>
    </div>
  )
}
