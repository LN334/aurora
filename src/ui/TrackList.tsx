import { useEffect, useRef, useState } from 'react'
import { sourceLabelById } from '../features/online/registry'
import { sourcesOf } from '../features/online/unify'
import { useSourceOrder } from '../features/settings/source-order'
import { openOnlineAlbum, openOnlineArtist, refOfTrack } from '../features/refs/navigate'
import { likedSourcesOf, toggleLiked, useLikeMarks } from '../features/favorites/likes'
import { likeTargets } from '../features/favorites/like-targets'
import type { LikeTarget } from '../features/favorites/like-targets'
import { useLikeMenu } from '../features/favorites/like-menu'
import { formatTime } from './format'
import { showFlash } from './flash'
import { ArrowUp, Heart, Locate, Note, Play } from './icons'
import { coverFor } from '../features/library/cover'
import { artThumbFor } from '../features/library/source'
import { rememberTracks } from '../features/library/seen'
import { artistParts } from './NameRef'
import type { Track } from '../types'

/**
 * 这一行的喜欢状态。
 *
 * 合并行的主行只是「优先级最高的那一版」，用户可能喜欢的是挂在后面另一家的
 * 那一版；只看主行会让心形明明收藏过却还是空的，所以整行任一版本喜欢过都算亮。
 *
 * 至于「哪家收了」——一颗心撑不起这个意思，落点是每行标题后面那几个平台徽章，
 * 每家一枚自己的心（见下面 flags 里那段）。一首歌在哪些平台有音源本来就各不相同，
 * 拿「平台全集」当分母去算「收了几成」是错的，所以这里只回答亮不亮。
 */
function rowLikeState(track: Track, marks: ReadonlyMap<string, ReadonlySet<string>>) {
  const liked = likedSourcesOf(track, marks)
  return { liked, isLiked: liked.length > 0 }
}

/** 一次挂多少行。够填满一屏还有富余，滚动时不至于每滚一下就补一批。 */
const PAGE = 120
const STEP = 200

export interface TrackMenuRequest {
  track: Track
  x: number
  y: number
  /**
   * 这一行是某张平台歌单里的。
   *
   * 菜单据此多一句「从这张歌单移除」——页面知道自己打开的是哪一张，行本身
   * 不知道，所以上下文跟着请求一起上去。
   */
  onlinePlaylist?: { providerId: string; id: number; name: string }
}

interface TrackListProps {
  tracks: Track[]
  currentId: string | null
  playing: boolean
  /** Starts the whole list at this position, so "next" continues down the list. */
  onPlayAt(index: number): void
  /** Opens the per-track actions menu. Omit to leave the affordance out. */
  onMenu?(request: TrackMenuRequest): void
}

/**
 * The dense view. A personal library runs to thousands of rows, so rows are
 * short, columns are aligned on tabular figures, and everything that is not the
 * title is quiet enough to skim past.
 */
export function TrackList({ tracks, currentId, playing, onPlayAt, onMenu }: TrackListProps) {
  /*
   * 这张表渲染过的歌都记一笔，详情页才查得到——详情只带 id 进路由，能查的
   * 只有本机库和最近听过，歌单、每日推荐里没播过的歌在那两张表里都没有。
   */
  useEffect(() => {
    rememberTracks(tracks)
  }, [tracks])

  const currentRow = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  /*
   * 长列表的两个去处：回到最上面，或者跳回正在播的那一行。
   *
   * 页面滚动容器是外层 .main__body，不是这张表，所以按钮浮在视口右下角、
   * 用 IntersectionObserver 盯住表头——表头离开视口才出现，一屏能看全的
   * 短列表上什么都不多。
   */
  const [toolsShown, setToolsShown] = useState(false)
  /*
   * 一屏之外的行走分批挂载。
   *
   * 收藏页现在六百多首，一次性把九千多个节点塞进 DOM 是一笔 290ms 的主线程
   * 长任务——点开这一页会明显顿一下。先挂一屏多一点，哨兵滚到跟前再续。
   */
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef<HTMLDivElement | null>(null)
  const visible = tracks.slice(0, limit)
  const signature = `${tracks.length}|${tracks[0]?.id ?? ''}`

  useEffect(() => {
    setLimit(PAGE)
  }, [signature])

  useEffect(() => {
    const node = sentinel.current
    if (!node || limit >= tracks.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setLimit((current) => Math.min(current + STEP, tracks.length))
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [limit, tracks.length])
  /*
   * 每一行右侧那颗心。收藏页、歌单、搜索结果、平台歌单都是同一份列表组件，
   * 所以「能不能喜欢」在这里做一次，所有列表就地都有了收藏键。
   */
  const likeMarks = useLikeMarks()
  /* 音源优先级一变，同一行的主版本与徽章顺序都要跟着重排。 */
  const order = useSourceOrder()

  /*
   * Whether a row needs to say where it came from.
   *
   * A screen of files, or a screen of one platform's songs, is already answered by
   * its own title; a badge on every row there is furniture. A list that genuinely
   * mixes origins - a playlist, the queue, cross-platform search - is the case the
   * README used to describe as unsolved, and there every row (the files too) gets
   * one label so the column reads as an answer rather than a scattering.
   */
  const origins = new Set(
    tracks.flatMap((track) =>
      track.versions?.length
        ? sourcesOf(track, order)
        : [Boolean(track.source) && track.source !== 'local' ? (track.source as string) : 'local']
    )
  )
  const mixed = origins.size > 1

  /*
   * Keep the playing track on screen.
   *
   * Keyed on the track id, not on render, so this fires when the track actually
   * changes. `block: 'nearest'` is the important part: a row that is already
   * visible does not move at all, which means this never fights someone who is
   * scrolling through the list themselves - it only reacts when the queue
   * advances past the edge of the viewport.
   *
   * The jump is instant rather than smooth. Smooth scrolling is driven by
   * requestAnimationFrame, so it stalls whenever the compositor is not animating
   * (a minimised window, a reduced-motion setting), and a track you cannot find
   * is worse than a scroll that does not glide.
   */
  useEffect(() => {
    if (!currentId) return
    const index = tracks.findIndex((track) => track.id === currentId)
    // 正在播的那行还没挂上就先把窗口撑到它，下一轮渲染完再滚。
    if (index >= limit) {
      setLimit(Math.min(tracks.length, index + 40))
      return
    }
    currentRow.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [currentId, limit, tracks])

  useEffect(() => {
    if (tracks.length <= 8) {
      setToolsShown(false)
      return
    }
    /*
     * 表头是 sticky 的，一直贴在滚动容器顶端，拿它做「滚走了没有」的判据
     * 永远不会成立——只能直接看容器的 scrollTop。
     */
    const box = rootRef.current?.closest('.main__body') as HTMLElement | null
    if (!box) return
    const onScroll = () => setToolsShown(box.scrollTop > 320)
    box.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => box.removeEventListener('scroll', onScroll)
  }, [tracks.length])

  const scrollToTop = () => {
    const box = rootRef.current?.closest('.main__body') as HTMLElement | null
    if (box) box.scrollTo({ top: 0, behavior: 'smooth' })
    else rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const showCurrent = () => {
    const index = tracks.findIndex((track) => track.id === currentId)
    if (index < 0) {
      showFlash(currentId ? '这一页里没有正在播的那首' : '还没有在播的歌')
      return
    }
    const reveal = () => {
      const row = rootRef.current?.querySelector<HTMLElement>('.trk.is-current')
      if (!row) return
      row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // 滚到中间之后再闪一下，否则滚得慢的时候看不出停在哪一行。
      row.classList.remove('is-flash')
      void row.offsetWidth
      row.classList.add('is-flash')
      window.setTimeout(() => row.classList.remove('is-flash'), 1500)
    }
    // 还在分批范围外，先把那一行挂出来，等它进 DOM 再滚。
    if (index >= limit) {
      setLimit(Math.min(tracks.length, index + 40))
      window.setTimeout(reveal, 80)
      return
    }
    reveal()
  }

  const openMenu = (track: Track, x: number, y: number) => {
    onMenu?.({ track, x, y })
  }

  return (
    <div className="tracks" role="list" aria-label="歌曲" ref={rootRef}>

      {visible.map((track, index) => {
        const isCurrent = track.id === currentId
        /*
         * 这一行在哪些平台上能听。
         *
         * 多平台统一之后，一行可能同时挂着网易云与 QQ 的版本：两个徽章并排列出
         * 来，用户一眼看到「这首歌这儿也能听」。整张列表只有一个来源时仍不印，
         * 页头已经说了。
         */
        const platforms = track.versions?.length ? sourcesOf(track, order) : mixed ? [track.source ?? 'local'] : []
        const refs = refOfTrack(track)
        /*
         * 早期版本给「没有专辑」的在线歌曲塞过一个 "?" 占位符，已经落进用户
         * 的最近播放历史里。这里在渲染时兜掉，免得列表里冒出一个孤零零的问号。
         */
        const albumLabel = track.album && track.album.trim() !== '?' ? track.album : ''
        const like = rowLikeState(track, likeMarks)
        const isLiked = like.isLiked
        const likedLabel = like.liked.map((source) => sourceLabelById(source)).join('、')
        const targets = likeTargets(track)
        /*
         * 往「这一家」的收藏里写一下。
         *
         * 徽章上的心与行尾的大心共用这一段：写不了的那家（QQ 目前没有收藏
         * 接口）说一句实话，而不是发一个注定被拒的请求。
         */
        const likeAt = (target: LikeTarget | undefined, name: string) => {
          if (!target || !target.writable) {
            showFlash(name + ' 没有收藏接口，这一版收不进去')
            return
          }
          void toggleLiked(target.track).then((result) => {
            if (!result.ok) {
              if (result.message) showFlash(result.message)
              return
            }
            showFlash(result.liked ? '已收藏到' + name : '已从' + name + '取消')
          })
        }
        return (
          <div
            key={track.id}
            role="listitem"
            // Only the playing row holds the ref; React clears it from the row
            // that stopped being current.
            ref={isCurrent ? currentRow : undefined}
            className={`trk${isCurrent ? ' is-current' : ''}`}
          >
            {/*
              The whole row is one click target, so it stays a plain overlay
              button rather than something nested. The actions button lives
              beside it and sits above it in the stacking order.
            */}
            <button
              className="trk__hit"
              onClick={() => onPlayAt(index)}
              onContextMenu={(event) => {
                if (!onMenu) return
                event.preventDefault()
                openMenu(track, event.clientX, event.clientY)
              }}
              title={`播放 ${track.title}`}
              aria-label={`播放 ${track.title}`}
            />

            <span className="trk__idx" role="cell">
              {isCurrent ? (
                <span className={`eq${playing ? ' is-live' : ''}`} aria-label="正在播放">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <>
                  <span className="trk__num tnum">{index + 1}</span>
                  <span className="trk__go" aria-hidden>
                    <Play size={12} />
                  </span>
                </>
              )}
            </span>

            {/*
              封面的作用是给长列表一个视觉锚点。

              Twilight Echo 的列表、网易云桌面端、汽水都用这个做法：每行一张
              小封面，扫列表时眼睛先认出封面，再去读标题。没有它，一屏 20 行
              全是一样长的灰字，只能一行行读——这是「挤」的真实来源，不是
              行高。没有封面的歌退回按 id 生成的渐变图，不让格子空掉。
            */}
            <span className="trk__art" role="cell" aria-hidden>
              <img
                src={artThumbFor(track) ?? coverFor(track.id, 96)}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(event) => {
                  event.currentTarget.style.visibility = 'hidden'
                }}
              />
            </span>

            {/*
              两行一条：标题在上，艺术家在下；专辑单独一列。

              上一版是网格表格——六列对齐、一行一个标题。它读起来像导出的
              CSV：行高 34px，行与行贴成一条带；标题短时右边空一大片，标题
              长时来源徽章被挤出去；专辑列永远只截到前半句。这里换成一屏
              能扫、又不像表格的条目：主标题一眼可读，副行把艺术家和专辑
              说清；专辑另起一列，宽度不够就在列内省略，而不是把别的列砍断。
            */}
            <span className="trk__main" role="cell">
              <span className="trk__title">
                <span className="trk__title-text">{track.title || '（无标题）'}</span>
                <span className="trk__flags">
                  {platforms.map((platform) => {
                    /*
                     * 徽章说的是「这一版来自这家」；心说的是「这家收没收」。
                     *
                     * 一首歌在哪些平台有音源各不相同（有的只在网易云，有的两家
                     * 都有），所以「收了几成」没有稳定分母；要区分平台，就把心
                     * 拆到每家徽章上：亮的那家收了，灰的那家没收，点一下直接切
                     * 这家的收藏，不用再去弹菜单选落点。
                     */
                    const marked = like.liked.includes(platform)
                    const name = sourceLabelById(platform)
                    const target = targets.find((item) => item.source === platform)
                    return (
                      <span
                        key={platform}
                        className={`badge trk__src trk__src--${platform}${marked ? ' is-liked' : ''}`}
                      >
                        {/*
                         * 心只在「这家收了」时出现。每家都挂一颗灰心的话，一屏
                         * 三十行就是三十颗没用的灰点——宽度也被撑得不齐，这才是
                         * 真正的「布局乱」。没收的那家保持原来的纯标签。
                         */}
                        {marked ? (
                          <button
                            className="trk__src-like"
                            onClick={(event) => {
                              event.stopPropagation()
                              likeAt(target, name)
                            }}
                            title={`${name} · 已喜欢，点一下取消`}
                            aria-label={'取消喜欢 ' + track.title + ' · ' + name}
                            aria-pressed
                          >
                            <Heart size={10} />
                          </button>
                        ) : null}
                        {name}
                      </span>
                    )
                  })}
                  {track.lossless ? (
                    <span className="badge" title={`${track.codec} 无损`}>
                      FLAC
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="trk__sub">
                {refs.artist ? (
                  artistParts(track).length > 1 ? (
                    <span className="trk__artists">
                      {artistParts(track).map((person, index) => (
                        <span key={`${person.id}:${index}`}>
                          {index > 0 ? <span className="trk__sep">/</span> : null}
                          {person.id ? (
                            <button
                              className="trk__ref"
                              onClick={(event) => {
                                event.stopPropagation()
                                openOnlineArtist(track.source ?? '', person.id)
                              }}
                              title={`去 ${person.name} 的页面`}
                            >
                              {person.name}
                            </button>
                          ) : (
                            <span>{person.name}</span>
                          )}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <button
                      className="trk__ref"
                      onClick={(event) => {
                        event.stopPropagation()
                        openOnlineArtist(track.source ?? '', refs.artist as number)
                      }}
                      title={`去 ${track.albumArtist || track.artist} 的页面`}
                    >
                      {track.artist}
                    </button>
                  )
                ) : (
                  <span>{track.artist}</span>
                )}

              </span>
            </span>

            {/*
              专辑单独一列。

              它不是副行的一部分：副行留给「谁唱的」，专辑放右列对齐。满宽的
              列表里如果右半屏是空的，读起来就是「左边挤成一坨、右边一片荒」；
              专辑列把这段空白填上，同时保留一条可扫的竖线。
            */}
            <span className="trk__album" role="cell">
              {albumLabel ? (
                refs.album ? (
                  <button
                    className="trk__ref"
                    onClick={(event) => {
                      event.stopPropagation()
                      openOnlineAlbum(track.source ?? '', refs.album as number)
                    }}
                    title={`去《${albumLabel}》`}
                  >
                    {albumLabel}
                  </button>
                ) : (
                  <span className="trk__muted">{albumLabel}</span>
                )
              ) : (
                <span className="trk__muted">—</span>
              )}
            </span>

            <span className="trk__time tnum" role="cell">
              {formatTime(track.duration)}
            </span>

            <span className="trk__acts">
              {/*
                心形是独立按钮，压在整行点击层之上。已喜欢的常显，未喜欢的
                悬停才出现——一行里只有它在乎「我喜不喜欢」，不该一直吵。
              */}
              <button
                className={'trk__like' + (isLiked ? ' is-liked' : '')}
                onClick={(event) => {
                  event.stopPropagation()
                  popLike(event.currentTarget)
                  /*
                   * 一行里有两个以上落点时先问收藏到哪儿；只有一个时直接切换。
                   * 菜单从按钮左上弹出，靠近哪边由 LikeMenu 自己夹进视口。
                   */
                  if (targets.length > 1) {
                    /*
                     * 一行里有好几个版本就先列出来。不能写的平台也列，并写明
                     * 「没有收藏接口」——只列能写的，用户会以为另一家不见了。
                     */
                    const rect = event.currentTarget.getBoundingClientRect()
                    useLikeMenu.getState().show({ track, x: rect.left - 12, y: rect.bottom + 6 })
                    return
                  }
                  /*
                   * 只有一个版本时直接写，但只写能写的：主行是 QQ（没有收藏接口）
                   * 而这一版就是它时，给一句实话，而不是发一个注定失败的请求。
                   */
                  const target = targets[0]
                  likeAt(target, target?.label ?? '这一家')
                }}
                title={isLiked ? `已喜欢：${likedLabel}` : '喜欢'}
                aria-label={(isLiked ? '取消喜欢 ' : '喜欢 ') + track.title}
                aria-pressed={isLiked}
              >
                <Heart size={14} />
              </button>

              {onMenu ? (
                <button
                  className="trk__more"
                  onClick={(event) => {
                    // Anchor the menu to the button rather than the pointer, so a
                    // keyboard activation opens it somewhere sensible too.
                    const rect = event.currentTarget.getBoundingClientRect()
                    openMenu(track, rect.right - 6, rect.bottom + 4)
                  }}
                  title="更多操作"
                  aria-label={`${track.title} 的更多操作`}
                >
                  ⋯
                </button>
              ) : null}
            </span>
          </div>
        )
      })}

      {limit < tracks.length ? <div className="tracks__more" ref={sentinel} aria-hidden /> : null}

      {tracks.length === 0 ? (
        <div className="tracks__empty">
          <Note size={18} />
          没有匹配的歌曲
        </div>
      ) : null}

      {toolsShown ? (
        <div className="tracks__tools">
          <button className="tracks__tool" onClick={showCurrent} disabled={!currentId} title="定位到正在播放" aria-label="定位到正在播放">
            <Locate size={16} />
          </button>
          <button className="tracks__tool" onClick={scrollToTop} title="回到顶部" aria-label="回到顶部">
            <ArrowUp size={16} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 心形被按下的那一下。
 *
 * 「已喜欢」原来只是颜色与填充的变化，跨过 120ms 才看得见，按快了就跟没反应
 * 一样。这里重放一次 CSS 动画：先缩到 0.76 再弹回 1，手上的动作立刻有了回话。
 * 直接操作 class 而不进 state —— 一次点击不该让整张列表重渲染。
 */
function popLike(el: HTMLElement): void {
  el.classList.remove('is-pop')
  // 读一次布局属性强制回流，否则同一个 class 连加两次不会重启动画。
  void el.offsetWidth
  el.classList.add('is-pop')
  window.setTimeout(() => el.classList.remove('is-pop'), 420)
}
