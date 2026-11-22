import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { usePlayer } from '../features/player/store'
import { player } from '../features/player/actions'
import { useRoam } from '../features/player/roam-session'
import { trackKey } from '../features/online/unify'
import { RoamRail } from './RoamRail'
import { PartyRibbon } from './PartyRibbon'
import type { Lyrics } from '../features/lyrics/lrc'
import { activeLineAt, spokenWords } from '../features/lyrics/lrc'
import { splitLyricLine } from '../features/lyrics/line-parts'
import { lineHeightOf, useLyricSize } from '../features/settings/lyric-size'
import { MODE_TEXT, modeOf } from '../features/player/mode'
import { Bar, useProgressPosition } from '../features/player/Bar'
import { wheelVolume } from '../features/player/volume'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { likeTargets } from '../features/favorites/like-targets'
import { useLikeMenu } from '../features/favorites/like-menu'
import { toast } from '../ui/toast'
import { artworkFor } from '../features/library/source'
import { sourceLabelById } from '../features/online/registry'
import { useOnlineStore } from '../features/online/store'
import { bridge } from '../bridge'
import { Artwork } from '../ui/Artwork'
import { formatTime } from '../ui/format'
import { AlbumName, ArtistName } from '../ui/NameRef'
import type { Track } from '../types'
import {
  ChevronLeft,
  Heart,
  Next,
  Note,
  Order,
  Pause,
  Play,
  Prev,
  Repeat,
  RepeatOne,
  Shuffle,
  DesktopLyrics,
  Expand,
  Queue,
  Sliders,
  User,
  Volume,
  VolumeMute, Comment as CommentIcon } from '../ui/icons'

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
  /* 播放页没有底栏，队列与调音台由这一页自己给入口。 */
  onOpenQueue(): void
  onOpenEq(): void
  /** 评论：跳到独立的评论页，只认正在播的这一首。 */
  onOpenComments(): void
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
  /* true = 这一程是跟着播放走的，收尾不能过冲；用户自己拨过之后才允许回弹 */
  const followRef = useRef(true)
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
  /* rAF 里要读歌词数据算逐字进度，但 effect 只挂一次，所以走 ref。 */
  const linesRef = useRef(lines)
  linesRef.current = lines
  /* 上一帧点亮到第几段、点亮的是哪一行；值没变就不碰 DOM。 */
  const litRef = useRef(-1)
  const litElRef = useRef<HTMLButtonElement | null>(null)

  /* 播放换行了：只要用户没在翻，就把目标交还给播放 */
  useEffect(() => {
    if (dragRef.current) return
    if (performance.now() < holdRef.current) return
    followRef.current = true
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
      if (!dragRef.current && now > holdRef.current) {
        followRef.current = true
        aimRef.current = activeRef.current
      }
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
          /* 收尾：跟着播放时用临界阻尼（2*sqrt(190)），一路滑过去不过冲；
             用户自己拨完才用欠阻尼，留一点弹回来的手感。
             跟着播放时要快一点：慢半拍会让「这一句」的提示看起来比唱得晚。 */
          const damp = followRef.current ? 39.05 : 14
          const acc = gap * 190 - velRef.current * damp
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
      /*
       * 逐字：只动当前行里那些 span，按播放位置点亮已经唱到的段。
       * 跟远近档位同一条原则——算出来才写，值没变不碰 DOM。
       */
      const rowIndex = activeRef.current
      const rowWords = linesRef.current[rowIndex]?.words
      const rowEl = list[rowIndex] ?? null
      if (rowWords && rowWords.length > 0 && rowEl) {
        const lit = spokenWords(rowWords, usePlayer.getState().position)
        if (rowEl !== litElRef.current || lit !== litRef.current) {
          const spans = rowEl.querySelectorAll<HTMLElement>('[data-w]')
          for (let i = 0; i < spans.length; i += 1) {
            spans[i].toggleAttribute('data-lit', i < lit)
          }
          litElRef.current = rowEl
          litRef.current = lit
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
      followRef.current = false
      holdRef.current = performance.now() + 4000
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    /*
     * 先不抓指针：一旦在按下时就 setPointerCapture，之后 pointerup 也回到这个
     * 容器，浏览器据此把 click 派发给容器而不是里面那一行歌词 —— 点歌词跳转
     * 就永远收不到事件。等真的拖出四个像素再抓，拖拽手感不变。
     */
    dragRef.current = { id: event.pointerId, y: event.clientY, base: posRef.current, moved: false }
    holdRef.current = performance.now() + 4000
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const dy = event.clientY - drag.y
    if (!drag.moved) {
      if (Math.abs(dy) <= 4) return
      drag.moved = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    posRef.current = Math.max(0, Math.min(lastRef.current, drag.base - dy / lineH.current))
    aimRef.current = posRef.current
    velRef.current = 0
    followRef.current = false
    holdRef.current = performance.now() + 4000
  }
  const endDrag = (): void => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (!drag.moved) return
    aimRef.current = Math.round(posRef.current)
    followRef.current = false
    holdRef.current = performance.now() + 4000
  }

  return (
    <>
      <PartyRibbon />
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
              {line.words && line.words.length > 0 ? (
                <span className="np__line-main np__line-words">
                  {line.words.map((word, wordIndex) => (
                    <span key={wordIndex} data-w={wordIndex}>
                      {word.text}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="np__line-main">{main}</span>
              )}
              {sub ? <span className="np__line-sub">{sub}</span> : null}
            </button>
          )
        })}
      </div>
    </div>
    </>
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
/** 没有平台 store 时用的空订阅；`useSyncExternalStore` 需要一个稳定的函数。 */
const NO_STORE_SUBSCRIBE = (): (() => void) => () => {}

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
  onOpenStage,
  onOpenQueue,
  onOpenComments,
  onOpenEq
}: NowPlayingProps) {
  const likedIds = useLikedIds()
  /*
   * 这一首能收到哪些地方：本机收藏、以及挂着版本的平台。一个落点时按钮直接切换，
   * 多落点时弹菜单——但两种都要能让用户看出会写到哪家，所以 title 与点击后的
   * 提示都从这里取名字。
   */
  const targets = useMemo(() => (track ? likeTargets(track) : []), [track])
  /*
   * 心形点亮后弹一下。列表行一直有这个小动画，播放页这颗大的反而只有颜色变化，
   * 点上去像没按到底——这一颗是页面里唯一大面积的「动作确认」，更该有。
   */
  const [likePop, setLikePop] = useState(false)
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const shuffle = usePlayer((state) => state.shuffle)
  const repeat = usePlayer((state) => state.repeat)
  const mode = modeOf(shuffle, repeat)
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
  /* 队列里的位置：这一页看不到队列，至少得知道「第几首 / 共几首」。 */
  const queueSize = usePlayer((state) => state.queue.length)
  const queueAt = usePlayer((state) => state.index)
  const rate = usePlayer((state) => state.playbackRate)

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

  /* 这块画到四百多像素；2x 屏按 800 取，原图 3000 是白占内存。 */
  const art = artworkFor(track, 800)
  /*
   * 以前这里直接写 source 的 id（netease/qq/…），页面上就是四个英文词。来源标签
   * 跟列表、搜索页统一成中文名，颜色也统一用那颗小色点。
   */
  const originSource = track.source && track.source !== 'local' ? track.source : 'local'
  const originLabel = originSource === 'local' ? '本机' : sourceLabelById(originSource)

  /*
   * 这一首实际到手的是什么档。
   *
   * 设置里选的是「想要的」，平台不一定给得了：会员过期、这首没有无损、上游临时
   * 只回 320k。以前这件事只写在 store 里，用户看不到 —— 于是「选了无损」与
   * 「听起来不像无损」之间没有解释。
   *
   * 只在记录里的 songId 就是当前这首时才显示：取流也会为下一首预取，拿别人的
   * 结论贴在当前这首上是错的。
   */
  const onlineStore = originSource === 'local' ? null : useOnlineStore(originSource)
  /*
   * 订阅，而不是读一次快照。
   *
   * 这条记录是取流成功之后才写进去的；读快照的话，当前这页要等别的状态变化
   * 才会重渲染，于是「选了无损、实际只拿到 320k」这句解释迟迟不出现——用户
   * 看到的就是「选了没用」。
   */
  const delivered = useSyncExternalStore(
    onlineStore?.subscribe ?? NO_STORE_SUBSCRIBE,
    () => {
      if (!onlineStore) return null
      const state = onlineStore.getState()
      return typeof track.onlineId === 'number' && state.deliveredLevelSongId === track.onlineId
        ? state.delivered
        : null
    }
  )
  const fellBack = useSyncExternalStore(
    onlineStore?.subscribe ?? NO_STORE_SUBSCRIBE,
    () => (onlineStore ? onlineStore.getState().deliveredFellBack : false)
  )

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
              <span className={`np__badge np__badge--${originSource}`}>{originLabel}</span>
              <ArtistName track={track} text={track.artist || '未知艺人'} />
              {track.album ? <span className="np__dot">·</span> : null}
              {track.album ? (
                <span className="np__album">
                  <AlbumName track={track} />
                </span>
              ) : null}
            </div>
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

      <div className="np__acts">
        <div className="np__acts-side np__acts-side--start">
          <button
          type="button"
          className={`np__like${liked ? ' is-on' : ''}${likePop ? ' is-pop' : ''}`}
          onClick={(event) => {
            setLikePop(true)
            /*
             * 兜底复位：animationend 不一定来（动画被跳过时），
             * 挂着的 is-pop 会让下一次点击不再有动画。
             */
            window.setTimeout(() => setLikePop(false), 520)
            /*
             * 与列表行同一个规矩：一个落点就直接写，写完说清写进了哪家；
             * 一首歌挂着两家版本时先问落到哪儿。这里以前直接
             * `toggleLiked(track)`——只写主版本、没有任何提示，用户不知道
             * 网易云和 QQ 到底哪家收了。
             */
            if (targets.length > 1) {
              const rect = event.currentTarget.getBoundingClientRect()
              useLikeMenu.getState().show({ track, x: rect.left, y: rect.bottom + 6 })
              return
            }
            const target = targets[0]
            const name = target?.label ?? '这一家'
            void toggleLiked(target?.track ?? track).then((result) => {
              if (!result.ok) {
                if (result.message) toast(result.message)
                return
              }
              toast(result.liked ? '已收藏到' + name : '已从' + name + '取消')
            })
          }}
          onAnimationEnd={(event) => {
            if (event.animationName === 'heartPop' || event.animationName === 'likeRing') setLikePop(false)
          }}
          /*
           * 右键 = 换一家收藏。左键永远走「直接落点 / 先问落点」，右键给那些
           * 明确想收藏到别处的人一条捷径，不必先点开再取消。
           */
          onContextMenu={(event) => {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            useLikeMenu.getState().show({ track, x: rect.left, y: rect.bottom + 6 })
          }}
          aria-pressed={liked}
          title={
            liked
              ? '取消喜欢'
              : targets.length > 1
                ? '喜欢到哪儿…'
                : `喜欢到${targets[0]?.label ?? '这一家'}`
          }
        >
          <Heart size={18} />
        </button>
        {/*
         * 漫游里播放模式没有可改的东西：整趟本来就从池子里随机挑、走到头
         * 还会自己续，再挂一个模式键只是把同一件事说第二遍。普通队列里
         * 它照旧，那里才有「顺序重排」与「到底停不停」可谈。
         */}
        <button type="button" className="icon-btn" data-tip="调音台" aria-label="调音台" onClick={onOpenEq}>
          <Sliders size={17} />
        </button>
        {roam ? null : (
          <button
            type="button"
            className={'np__mode' + (mode === 'order' ? '' : ' is-on')}
            onClick={() => player.cycleMode()}
            title={MODE_TEXT[mode].hint}
            aria-label={MODE_TEXT[mode].label}
          >
            {mode === 'shuffle' ? (
              <Shuffle size={17} />
            ) : mode === 'one' ? (
              <RepeatOne size={17} />
            ) : mode === 'loop' ? (
              <Repeat size={17} />
            ) : (
              <Order size={17} />
            )}
          </button>
        )}
        <button type="button" className="icon-btn" data-tip="播放队列" aria-label="播放队列" onClick={onOpenQueue}>
          <Queue size={17} />
        </button>
        </div>
        <div className="np__acts-side np__acts-side--end">
          <button type="button" className="icon-btn" data-tip="评论" aria-label="评论" onClick={onOpenComments}>
            <CommentIcon size={17} />
          </button>
              {delivered ? (
                <>
                  <span className="np__dot">·</span>
                  <span
                    className={`np__tier${fellBack ? ' is-fell-back' : ''}`}
                    title={delivered}
                  >
                    {delivered.split(' · ')[0]}
                  </span>
                </>
              ) : null}
              <button
                type="button"
                className={`np__rate${rate === 1 ? '' : ' is-on'}`}
                onClick={() => {
                  const rates = [0.75, 1, 1.25, 1.5, 2]
                  const at = rates.indexOf(rate)
                  usePlayer.getState().setPlaybackRate(rates[(at + 1) % rates.length] ?? 1)
                }}
                data-tip="播放速度"
                aria-label={`播放速度 ${rate} 倍`}
              >
                {rate}×
              </button>
        {/*
         * 音量：一颗静音键，滑条藏在它上面，鼠标移上来才浮出来。
         *
         * 底栏那条滑条能细调，可这一页把底栏收走了——页面上只剩一颗静音键，
         * 想调小声只能退回首页。常驻一条又会把这一行挤满，所以做成悬停浮层：
         * 竖向条按 clientY 反算，抬头看数值，低头看条。滚轮、方向键、拖动都在。
         */}
        <div className="np__vol">
          <button
            type="button"
            className="np__mute"
            onClick={() => player.toggleMute()}
            title={muted ? '取消静音' : '静音'}
            aria-label={muted ? '取消静音' : '静音'}
            /*
             * 滚轮挂在按键上，不只挂在滑条上。
             *
             * 滑条平时是浮层，鼠标得先探到它上面才滚得动；而人是先看到
             * 静音键、顺手就滚的。两处走同一个换算，音量不会因为入口
             * 不同而一格大一格小。
             */
            onWheel={(event) => {
              if (muted) player.toggleMute()
              player.setVolume(wheelVolume(muted ? 0 : volume, event.deltaY > 0 ? -1 : 1))
            }}
          >
            {muted || volume === 0 ? <VolumeMute size={17} /> : <Volume size={17} />}
          </button>
          <div className="np__vol-pop">
            <span className="np__vol-val">{muted ? '静音' : Math.round(volume * 100)}</span>
            <Bar
              className="np__vol-bar"
              value={muted ? 0 : volume}
              onChange={(next) => {
                // 静音状态下拖滑条，是想把声音调回来，不是想把静音调得更静。
                if (muted) player.toggleMute()
                player.setVolume(next)
              }}
              ariaLabel="音量"
              valueText={muted ? '已静音' : `音量 ${Math.round(volume * 100)}%`}
              onWheelDelta={(direction) => {
                if (muted) player.toggleMute()
                player.setVolume(wheelVolume(muted ? 0 : volume, direction))
              }}
            />
          </div>
        </div>
        <button
          type="button"
          className="icon-btn np-opt"
          data-tip="一起听"
          aria-label="一起听"
          onClick={() => {
            window.location.hash = '#party'
          }}
        >
          <User size={17} />
        </button>
        <button
          type="button"
          className="icon-btn np-opt"
          data-tip="桌面歌词"
          aria-label="桌面歌词"
          onClick={() => void bridge.overlay.toggle()}
        >
          <DesktopLyrics size={17} />
        </button>
        <button type="button" className="icon-btn np-opt" data-tip="舞台" aria-label="舞台" onClick={onOpenStage}>
          <Expand size={17} />
        </button>
        </div>
      </div>

      {roam ? <RoamRail /> : null}

      <footer className="np__foot">
        <NpProgress
          duration={duration}
          onSeekRatio={onSeekRatio}
          posy={
            queueSize > 1 && queueAt >= 0 ? (
              <span className="np__posy">
                <span className="np__posy-k">队列</span>
                {queueAt + 1} / {queueSize}
              </span>
            ) : null
          }
        />
        {/*
         * 上一首 / 播放 / 下一首放在播放条（进度条）下面，横向上仍钉在窗口
         * 几何中心。以前它们在那排工具键的中间，压在进度条上沿，既挤又容易
         * 点错；挪到下面之后这一排只放工具，三颗单独占一行。
         */}
        {/*
         * 上一首 / 播放 / 下一首和「接下来」放在同一条线上：三颗钉在窗口几何
         * 中心（绝对定位，左右各挂多少键都不偏移），「接下来」贴这一行的右端。
         * 以前它们各占一行，进度条下面要吃掉三条横带。
         */}
        <div className="np__bottom">
          <div className="np__acts-transport">
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
          </div>
          {roam ? null : (
            <div className="np__next">
              {upcoming ? (
                <>
                  <span className="np__next-k">接下来</span>
                  <span className="np__next-t" title={upcoming.title}>
                    {upcoming.title}
                  </span>
                  <span className="np__next-a">
                    <ArtistName track={upcoming} />
                  </span>
                </>
              ) : (
                <span className="np__next-k">队列里没有下一首了</span>
              )}
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

/**
 * 进度条：订阅量化后的位置，所以它每秒只重渲染八次。
 *
 * `posy` 是「队列里第几首」那一小截：它读的是位置，挂在进度这一行才对得上，
 * 摆在工具栏里则没人知道那串数字数的是什么。
 */
function NpProgress({
  duration,
  onSeekRatio,
  posy
}: {
  duration: number
  onSeekRatio(ratio: number): void
  posy?: ReactNode
}) {
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
      {posy ?? null}
    </div>
  )
}
