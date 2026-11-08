import { activeLineAt, type Lyrics } from '../features/lyrics/lrc'
import type { Palette } from '../features/library/palette'
import type { Track } from '../types'
import { useProgressPosition } from '../features/player/Bar'
import { formatTime } from '../ui/format'
import { ChevronLeft, Note, Next, Pause, Play, Prev, Volume, VolumeMute } from '../ui/icons'
import { Artwork } from '../ui/Artwork'
import { artworkFor } from '../features/library/source'
import { usePlayer } from '../features/player/store'
import { STAGE_STYLES, setStageStyle, useStageStyle, type StageStyleId } from '../features/lyrics/stage-style'
import { splitLyricLine } from '../features/lyrics/line-parts'
import { player } from '../features/player/actions'
import { useState, type CSSProperties } from 'react'
import { Visualizer } from './Visualizer'
import { Backdrop } from '../features/wallpaper/Backdrop'
import { chooseEntry } from '../features/wallpaper/pure'
import { useWallpaper } from '../features/wallpaper/store'

/** Lines shown above and below the active one. Fixed, so centring is exact. */
const SPAN = 4
const SLOTS = SPAN * 2 + 1

interface LyricColumnProps {
  lyrics: Lyrics
  onSeek(seconds: number): void
  style: StageStyleId
}

/**
 * 卡拉 OK：底色是暗的，彩色那层按演唱进度从左往右推开。
 *
 * 只有当前行挂这个组件，所以 125ms 一次的重渲染只影响一行文字，父级的九个
 * 槽位和可视化 canvas 完全不动。
 */
function KaraokeText({
  text,
  start,
  end,
  onSeek,
  title
}: {
  text: string
  start: number
  end: number
  onSeek(): void
  title: string
}) {
  const position = useProgressPosition()
  const span = Math.max(0.4, end - start)
  const ratio = Math.min(1, Math.max(0, (position - start) / span))
  const { main, sub } = splitLyricLine(text)

  return (
    <button
      type="button"
      className="lyr__text lyr__text--karaoke"
      style={{ '--fill': (ratio * 100).toFixed(2) + '%' } as CSSProperties}
      onClick={onSeek}
      title={title}
    >
      <span className="lyr__main">{main}</span>
      {sub ? <span className="lyr__sub">{sub}</span> : null}
    </button>
  )
}

/**
 * 逐字：把当前行拆成单字，第 i 个字延迟 i*55ms 浮出来。
 *
 * key 用的是行号（在 LyricColumn 里给），换行时整个组件重挂载，动画重播。
 */
function TypewriterText({ text, onSeek, title }: { text: string; onSeek(): void; title: string }) {
  const { main, sub } = splitLyricLine(text)
  const chars = Array.from(main)
  /*
   * 整行别超过 0.9 秒落地：短句每个字慢慢来才有呼吸感，长句照 55ms 排下去要两秒
   * 多，读到一半歌已经唱到下一句了。
   */
  const step = Math.min(55, Math.max(16, Math.round(900 / Math.max(1, chars.length))))
  return (
    <button type="button" className="lyr__text lyr__text--chars" onClick={onSeek} title={title}>
      <span className="lyr__chars">
        {chars.map((ch, index) => (
          <span key={index} className="lyr__ch" style={{ '--i': String(index), '--step': step + 'ms' } as CSSProperties}>
            {ch === ' ' ? '\u00a0' : ch}
          </span>
        ))}
      </span>
      {sub ? <span className="lyr__sub">{sub}</span> : null}
    </button>
  )
}

function LyricColumn({ lyrics, onSeek, style }: LyricColumnProps) {
  const active = usePlayer((state) => activeLineAt(lyrics.lines, state.position))
  // Before the first line starts, anchor on it so the stage is never blank.
  const anchor = active < 0 ? 0 : active
  const nextLine = lyrics.lines[anchor + 1]

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
    <div className="stage__lyrics" role="list" aria-live="off">
      {slots.map((slot) => (
        <div
          key={slot.key}
          role="listitem"
          className={'lyr lyr--d' + Math.min(slot.distance, 4) + (slot.isActive ? ' is-active' : '') + (slot.isPending ? ' is-pending' : '')}
        >
          {slot.line ? (
            slot.isActive && style === 'karaoke' ? (
              <KaraokeText
                key={slot.key}
                text={slot.line.text || '·'}
                start={slot.line.time}
                end={nextLine ? nextLine.time : slot.line.time + 4}
                onSeek={() => onSeek(slot.line.time)}
                title={'跳到 ' + formatTime(slot.line.time)}
              />
            ) : slot.isActive && style === 'typewriter' ? (
              <TypewriterText
                key={slot.key}
                text={slot.line.text || '·'}
                onSeek={() => onSeek(slot.line.time)}
                title={'跳到 ' + formatTime(slot.line.time)}
              />
            ) : (
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
            )
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
                <span className="stage__artist">{track.artist}</span>
                {track.album ? (
                  <>
                    <span className="stage__sep" aria-hidden="true">
                      ·
                    </span>
                    <span className="stage__album">{track.album}</span>
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
        <LyricColumn lyrics={lyrics} onSeek={onSeek} style={style} />
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
      </footer>
    </div>
  )
}
