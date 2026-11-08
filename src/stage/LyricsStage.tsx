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
import { STAGE_STYLES, setStageStyle, useStageStyle } from '../features/lyrics/stage-style'
import { splitLyricLine } from '../features/lyrics/line-parts'
import { player } from '../features/player/actions'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Visualizer } from './Visualizer'
import { Backdrop } from '../features/wallpaper/Backdrop'
import { chooseEntry } from '../features/wallpaper/pure'
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
  // Before the first line starts, anchor on it so the stage is never blank.
  const base = active < 0 ? 0 : active
  /*
   * 手动翻看。
   *
   * 舞台原来只有一个位置：正在唱的那一行。想抬头看刚唱过的那句、或者往下看看
   * 后面是什么，只能等它自己唱过去。滚轮（触控板一样）给一个「钉住某一行」的
   * 位置，画面停在那儿不再随播放漂移；停手 6 秒、换歌、或者点「回到正在唱」，
   * 就把位置交还给歌曲。
   *
   * 钉住的行号由舞台持有：「回到正在唱」挂在底栏上，不能和歌词渲染绑在一个
   * 容器里——那个容器的上下渐隐遮罩正是它以前又暗又小的原因。
   */
  const listRef = useRef<HTMLDivElement | null>(null)
  const last = Math.max(0, lyrics.lines.length - 1)
  const anchor = pinned === null ? base : Math.max(0, Math.min(last, pinned))

  /*
   * wheel 必须是非被动监听：舞台自己不该滚，但外层容器会跟着滚一下。这里
   * 拦下默认行为，只把它当作「上下翻一行」。
   */
  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (!event.deltaY) return
      event.preventDefault()
      const step = event.deltaY > 0 ? 1 : -1
      const from = pinned === null ? base : pinned
      onPin(Math.max(0, Math.min(last, from + step)))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [base, last, pinned, onPin])

  /*
   * 换行时给整列轻轻推一格（见 .stage__lyrics.is-shift-next）。
   *
   * 九个槽位的内容是按行号重挂载的，换行就是九格同时换成下一批。只靠格子
   * 自己的淡入，看上去是「原地闪」；让整列带着方向滑一下，才像在滚。方向
   * 用上一个锚点比较，往回翻（滚轮或点上一句）就反着推。
   */
  const prevAnchor = useRef(anchor)
  useEffect(() => {
    if (anchor === prevAnchor.current) return
    const next = anchor > prevAnchor.current
    prevAnchor.current = anchor
    const node = listRef.current
    if (!node) return
    node.classList.remove('is-shift-next', 'is-shift-prev')
    // 读一次 offsetWidth，同名动画才会从头再跑一遍。
    void node.offsetWidth
    node.classList.add(next ? 'is-shift-next' : 'is-shift-prev')
  }, [anchor])

  const slots = Array.from({ length: SLOTS }, (_, i) => {
    const lineIndex = anchor - SPAN + i
    const line = lyrics.lines[lineIndex]
    const distance = Math.abs(i - SPAN)
    return {
      key: lineIndex,
      line,
      distance,
      isActive: active >= 0 && lineIndex === active,
      // Before the first timestamp there is nothing to highlight; the centre
      // slot holds the upcoming line but must not read as "currently playing".
      isPending: active < 0 && distance === 0
    }
  })

  return (
    <div className="stage__lyrics" role="list" aria-live="off" ref={listRef}>
      {slots.map((slot) => (
        <div
          key={slot.key}
          role="listitem"
          className={'lyr lyr--d' + Math.min(slot.distance, 4) + (slot.isActive ? ' is-active' : '') + (slot.isPending ? ' is-pending' : '')}
        >
          {slot.line ? (
            <button
              type="button"
              className="lyr__text"
              onClick={() => onSeek(slot.line.time)}
              title={'跳到 ' + formatTime(slot.line.time)}
            >
              {(() => {
                const { main, sub } = splitLyricLine(slot.line.text || '·')
                return (
                  <>
                    <span className="lyr__main">{main}</span>
                    {sub ? <span className="lyr__sub">{sub}</span> : null}
                  </>
                )
              })()}
            </button>
          ) : (
            <span className="lyr__text lyr__text--empty" />
          )}
        </div>
      ))}
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
  onClose
}: LyricsStageProps) {
  const style = useStageStyle()
  const [looksOpen, setLooksOpen] = useState(false)

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
      className={['stage', wallpaper ? 'stage--wallpaper' : '', 'stage--lyric-' + style].filter(Boolean).join(' ')}
      // --wp-level 同时喂给壁纸的遮罩和舞台自己的渐变，和外壳用的是同一个值。
      style={
        wallpaper
          ? ({ '--wp-level': String(wallpaperStrength), '--stage-tint': palette.colors[0] } as CSSProperties)
          : undefined
      }
    >
      {wallpaper ? <Backdrop entry={wallpaper} /> : <Visualizer getSpectrum={getSpectrum} palette={palette} />}

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
        <div className="stage__aside">
          <button
            type="button"
            className={'stage__look' + (looksOpen ? ' is-open' : '')}
            onClick={() => setLooksOpen((open) => !open)}
            aria-expanded={looksOpen}
            aria-haspopup="listbox"
          >
            样式
          </button>
          {looksOpen ? (
            <div className="stage__looks" role="listbox" aria-label="歌词演出模板">
              {STAGE_STYLES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === style}
                  className={'stage__look-item' + (item.id === style ? ' is-on' : '')}
                  onClick={() => {
                    setStageStyle(item.id)
                    setLooksOpen(false)
                  }}
                >
                  <span className="stage__look-name">{item.name}</span>
                  <span className="stage__look-note">{item.note}</span>
                </button>
              ))}
            </div>
          ) : null}
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
