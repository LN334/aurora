import { useEffect, useRef } from 'react'
import { usePlayer } from '../features/player/store'
import { player } from '../features/player/actions'
import { useRoam } from '../features/player/roam-session'
import { trackKey } from '../features/online/unify'
import { RoamRail } from './RoamRail'
import type { Lyrics } from '../features/lyrics/lrc'
import { activeLineAt } from '../features/lyrics/lrc'
import { splitLyricLine } from '../features/lyrics/line-parts'
import { lineHeightOf, useLyricSize } from '../features/settings/lyric-size'
import { useProgressPosition } from '../features/player/Bar'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { artworkFor } from '../features/library/source'
import { Artwork } from '../ui/Artwork'
import { formatTime } from '../ui/format'
import { AlbumName, ArtistName } from '../ui/NameRef'
import type { Track } from '../types'
import {
  ChevronLeft,
  Heart,
  Next,
  Note,
  Pause,
  Play,
  Prev,
  Repeat,
  RepeatOne,
  Shuffle,
  Volume,
  VolumeMute
} from '../ui/icons'

/*
 * 行高必须和 CSS 里 .np__line 的高度一致：歌词靠 translateY 精确居中，
 * 而不是靠 scrollTop —— 后者在换歌、跳行、窗口缩放时会抖一下。
 * 字号可调之后两边都从 lineHeightOf() 算，别在这里另写一个数。
 */

interface NowPlayingProps {
  track: Track | null
  lyrics: Lyrics
  duration: number
  playing: boolean
  /** 在线歌词开关当前是否打开；关着时下面给出入口。 */
  onlineEnabled: boolean
  onEnableOnline(): void
  onBack(): void
  onSeek(seconds: number): void
  onSeekRatio(ratio: number): void
  onOpenStage(): void
}

/**
 * 歌词可以自己翻。
 *
 * 原来是「播放到哪行，整条就滑到哪行」，想看一眼刚唱过的那句或者下面还有什么，
 * 只能等下——和舞台那种「翻一下就钉住」差得远。这里补上同一件事：滚轮、拖动都
 * 能把歌词往上往下拨，停手四秒交还播放，还在翻的时候播放的进度也照旧往前走。
 *
 * 位移不走 React：整列只有一条 transform，每帧在 rAF 里直接写，跨行时顺手把每行
 * 的远近档位刷一遍（远处小、暗）。这样翻的时候一次重渲染都不发生——和每日推荐
 * 那道封面墙是同一个做法，卡顿就是从「每帧 setState」来的。
 */
function LyricRoll({
  lines,
  active,
  onSeek
}: {
  lines: Lyrics['lines']
  active: number
  onSeek(seconds: number): void
}) {
  const win = useRef<HTMLDivElement | null>(null)
  const strip = useRef<HTMLDivElement | null>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const posRef = useRef(0)
  const aimRef = useRef(0)
  const velRef = useRef(0)
  const holdRef = useRef(0)
  const activeRef = useRef(0)
  const farRef = useRef<number[]>([])
  const dragRef = useRef<{ id: number; y: number; base: number; moved: boolean } | null>(null)
  const clockRef = useRef(0)
  const rafRef = useRef(0)
  const size = useLyricSize()
  const lineH = useRef(lineHeightOf(size))
  const last = Math.max(0, lines.length - 1)
  const lastRef = useRef(last)
  lastRef.current = last
  activeRef.current = active < 0 ? 0 : active

  /* 播放换行了：只要用户没在翻，就把目标交还给播放 */
  useEffect(() => {
    if (dragRef.current) return
    if (performance.now() < holdRef.current) return
    aimRef.current = activeRef.current
  }, [active])

  /* 换歌、换歌词：回到新的当前行，别停在上一首的位置 */
  useEffect(() => {
    posRef.current = activeRef.current
    aimRef.current = activeRef.current
    velRef.current = 0
    holdRef.current = 0
    farRef.current = []
  }, [lines])

  /* 字号改了：行高跟着变，按新行高重新落到当前行 */
  useEffect(() => {
    lineH.current = lineHeightOf(size)
    posRef.current = activeRef.current
    aimRef.current = activeRef.current
    velRef.current = 0
  }, [size])

  useEffect(() => {
    let alive = true
    const tick = (now: number): void => {
      if (!alive) return
      const previous = clockRef.current || now
      clockRef.current = now
      const dt = Math.min(0.05, Math.max(0.004, (now - previous) / 1000))
      /* 停手四秒之后把位置还给播放 */
      if (!dragRef.current && now > holdRef.current) aimRef.current = activeRef.current
      const aim = Math.max(0, Math.min(lastRef.current, aimRef.current))
      const gap = aim - posRef.current
      if (!dragRef.current) {
        if (Math.abs(gap) < 0.004 && Math.abs(velRef.current) < 0.03) {
          posRef.current = aim
          velRef.current = 0
        } else if (Math.abs(gap) > 1.2) {
          /* 远距离：速度跟着距离给，翻得再快也不会一顿一顿 */
          const want = Math.max(-9, Math.min(9, gap * 8 + Math.sign(gap) * 0.45))
          velRef.current += (want - velRef.current) * Math.min(1, dt * 26)
          posRef.current += velRef.current * dt
        } else {
          /* 收尾欠阻尼：滑过去、弹回来、站住 */
          const acc = gap * 190 - velRef.current * 14
          velRef.current += acc * dt
          posRef.current += velRef.current * dt
        }
      }
      const pos = Math.max(0, Math.min(lastRef.current, posRef.current))
      if (strip.current) {
        const h = lineH.current
        strip.current.style.transform = 'translate3d(0,' + (-(pos * h + h / 2)).toFixed(2) + 'px,0)'
      }
      /* 远近档位跟着显示的中心行走，不是跟着播放行走 */
      const centre = Math.round(pos)
      const list = rows.current
      for (let i = 0; i < list.length; i += 1) {
        const far = Math.min(4, Math.abs(i - centre))
        if (farRef.current[i] !== far) {
          farRef.current[i] = far
          list[i]?.setAttribute('data-far', String(far))
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [])

  /* 滚轮：非被动监听，拦下页面滚动 */
  useEffect(() => {
    const el = win.current
    if (!el) return
    const wheel = (event: WheelEvent): void => {
      if (!event.deltaY) return
      event.preventDefault()
      aimRef.current += Math.max(-2, Math.min(2, event.deltaY / 120))
      holdRef.current = performance.now() + 4000
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id: event.pointerId, y: event.clientY, base: posRef.current, moved: false }
    holdRef.current = performance.now() + 4000
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.abs(dy) > 4) drag.moved = true
    if (!drag.moved) return
    posRef.current = Math.max(0, Math.min(lastRef.current, drag.base - dy / lineH.current))
    aimRef.current = posRef.current
    velRef.current = 0
    holdRef.current = performance.now() + 4000
  }
  const endDrag = (): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (!drag.moved) return
    aimRef.current = Math.round(posRef.current)
    holdRef.current = performance.now() + 4000
  }

  return (
    <div
      className="np__lyr-window"
      ref={win}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="np__lyr" ref={strip}>
        {lines.map((line, index) => {
          const { main, sub } = splitLyricLine(line.text || '·')
          return (
            <button
              key={index}
              type="button"
              className={`np__line${index === active ? ' is-active' : ''}`}
              data-far={Math.min(4, Math.abs(index - (active < 0 ? 0 : active)))}
              ref={(el) => {
                rows.current[index] = el
              }}
              onClick={() => onSeek(line.time)}
              title={formatTime(line.time)}
            >
              <span className="np__line-main">{main}</span>
              {sub ? <span className="np__line-sub">{sub}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
/**
 * 正在播放。
 *
 * 这页和「歌曲详情」「舞台」是三件不同的事，别合并：
 *
 * - 歌曲详情回答「这首歌是什么」：谁唱的、什么专辑、哪个文件、我喜欢过没有。
 * - 这一页回答「现在正听到哪」：封面、歌词跟着走、想跳哪一句跳哪一句。
 * - 舞台是全屏沉浸，把外壳整个让出去。
 *
 * 所以这一页留着外壳（左栏、播放条都在），只是把中间那块换成封面加歌词。
 */
export function NowPlayingPage({
  track,
  lyrics,
  duration,
  playing,
  onlineEnabled,
  onEnableOnline,
  onBack,
  onSeek,
  onSeekRatio,
  onOpenStage
}: NowPlayingProps) {
  const likedIds = useLikedIds()
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const shuffle = usePlayer((state) => state.shuffle)
  const repeat = usePlayer((state) => state.repeat)
  const liked = track ? likedIds.has(track.id) : false
  /*
   * 这一首在不在当前这趟漫游里。用 trackKey 对而不是对象引用：队列里可能放的是
   * 合并前的另一份同名曲，引用不同、其实是同一首。
   */
  const roamTracks = useRoam((state) => state.tracks)
  const roam = Boolean(
    track && roamTracks.some((item) => trackKey(item) === trackKey(track))
  )
  // 队列里的下一首：底部那片空白里放一句「接下来」，比空着有用。
  const upcoming = usePlayer((state) => {
    if (state.queue.length === 0) return null
    const next = state.index + 1
    if (next >= state.queue.length) return state.repeat === 'all' ? (state.queue[0] ?? null) : null
    return state.queue[next] ?? null
  })

  // 只订阅「第几行」而不是 position：进度每秒跳六十次，这个值一首歌只变几十次。
  const active = usePlayer((state) => (lyrics.lines.length > 0 ? activeLineAt(lyrics.lines, state.position) : -1))

  if (!track) {
    return (
      <div className="np np--empty">
        <button type="button" className="np__back" onClick={onBack} aria-label="返回">
          <ChevronLeft size={19} />
        </button>
        <div className="np__nothing">
          <Note size={30} />
          <p>还没有在播放</p>
          <span>从推荐里挑一首，或者去本机音乐里放一张专辑。</span>
        </div>
      </div>
    )
  }

  const art = artworkFor(track)
  const origin = track.source && track.source !== 'local' ? track.source : '本机'

  return (
    <div className="np">

      <div className="np__grid">
        <div className="np__left">
          <button
            type="button"
            className="np__cover"
            onClick={onOpenStage}
            title="进舞台"
            aria-label="进舞台"
          >
            <Artwork src={art} fallback={<Note size={64} />} />
            <span className="np__cover-hint">舞台</span>
          </button>

          <div className="np__meta">
            <h1 className="np__title" title={track.title}>
              {track.title}
            </h1>
            <div className="np__sub">
              <span className="np__badge">{origin}</span>
              <ArtistName track={track} text={track.artist || '未知艺人'} />
              {track.album ? <span className="np__dot">·</span> : null}
              {track.album ? (
                <span className="np__album">
                  <AlbumName track={track} />
                </span>
              ) : null}
            </div>
          </div>

          <div className="np__acts">
            <button
              type="button"
              className={`np__like${liked ? ' is-on' : ''}`}
              onClick={() => void toggleLiked(track)}
              aria-pressed={liked}
              title={liked ? '取消喜欢' : '喜欢'}
            >
              <Heart size={18} />
            </button>
            {/*
             * 漫游里这两颗没有事可做：整趟本来就从池子里随机挑，再挂一次
             * 「随机播放」是把同一句话再说一遍；「列表循环 / 单曲循环」对一条
             * 会自己续长的队列也说不清——漫游的循环就是一直往下走。普通队列
             * 里它们照旧，那里才有「顺序重排」与「到底停不停」可谈。
             */}
            {roam ? null : (
              <button
                type="button"
                className={`np__shuf${shuffle ? ' is-on' : ''}`}
                onClick={() => player.toggleShuffle()}
                title="随机播放"
                aria-pressed={shuffle}
              >
                <Shuffle size={17} />
              </button>
            )}
            <button type="button" className="np__step" onClick={() => player.prev()} title="上一首">
              <Prev size={20} />
            </button>
            <button
              type="button"
              className="np__play"
              onClick={() => player.toggle()}
              title={playing ? '暂停' : '播放'}
            >
              {playing ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button type="button" className="np__step" onClick={() => player.next()} title="下一首">
              <Next size={20} />
            </button>
            {roam ? null : (
              <button
                type="button"
                className={`np__rep${repeat !== 'off' ? ' is-on' : ''}`}
                onClick={() => player.cycleRepeat()}
                title={repeat === 'one' ? '单曲循环' : repeat === 'all' ? '列表循环' : '不循环'}
              >
                {repeat === 'one' ? <RepeatOne size={17} /> : <Repeat size={17} />}
              </button>
            )}
            <button type="button" className="np__vol" onClick={() => player.toggleMute()} title={muted ? '取消静音' : '静音'}>
              {muted || volume === 0 ? <VolumeMute size={17} /> : <Volume size={17} />}
            </button>
          </div>
        </div>

        <div className="np__right">
          {lyrics.lines.length > 0 ? (
            <LyricRoll lines={lyrics.lines} active={active} onSeek={onSeek} />
          ) : (
            <div className="np__nolyrics">
              <Note size={22} />
              这首歌还没有歌词
              {/*
               * 没有词多半是这一家（酷狗、汽水）没有歌词接口，而不是这首歌真的没词：
               * 同一首在网易云或 QQ 上常常是有的。给出路而不是只报一句空话——在线库
               * 默认关着，用户不点开关就永远不知道还有这条路。
               */}
              {onlineEnabled ? null : (
                <>
                  <button
                    type="button"
                    className="btn np__nolyrics-act"
                    onClick={onEnableOnline}
                  >
                    从公共歌词库找一次
                  </button>
                  <p className="np__nolyrics-hint">会把歌名和艺术家发送到 lrclib.net</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {roam ? <RoamRail /> : null}

      <footer className="np__foot">
        {roam ? null : (
        <div className="np__next">
          {upcoming ? (
            <>
              <span className="np__next-k">接下来</span>
              <span className="np__next-t" title={upcoming.title}>
                {upcoming.title}
              </span>
              <span className="np__next-a"><ArtistName track={upcoming} /></span>
            </>
          ) : (
            <span className="np__next-k">队列里没有下一首了</span>
          )}
        </div>
        )}
        <NpProgress duration={duration} onSeekRatio={onSeekRatio} />
      </footer>
    </div>
  )
}

/** 进度条：订阅量化后的位置，所以它每秒只重渲染八次。 */
function NpProgress({ duration, onSeekRatio }: { duration: number; onSeekRatio(ratio: number): void }) {
  const position = useProgressPosition()
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0

  return (
    <div className="np__progress">
      <span className="np__time">{formatTime(position)}</span>
      <div
        className="np__track"
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          if (rect.width > 0) onSeekRatio((event.clientX - rect.left) / rect.width)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') onSeekRatio(Math.min(1, ratio + 0.02))
          else if (event.key === 'ArrowLeft') onSeekRatio(Math.max(0, ratio - 0.02))
        }}
      >
        <div className="np__track-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="np__time">{formatTime(duration)}</span>
    </div>
  )
}
