import { useEffect, useRef } from 'react'
import { sourceLabelById } from '../features/online/registry'
import { sourcesOf } from '../features/online/unify'
import { useSourceOrder } from '../features/settings/source-order'
import { openOnlineAlbum, openOnlineArtist, refOfTrack } from '../features/refs/navigate'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { likeTargets } from '../features/favorites/like-targets'
import { useLikeMenu } from '../features/favorites/like-menu'
import { formatTime } from './format'
import { showFlash } from './flash'
import { Heart, Note } from './icons'
import type { Track } from '../types'

/**
 * 一行里的艺术家拆成独立的几个名字。
 *
 * 名字串里有几个就排几个；artistRefs 里同名的那几个配上 id 能点，配不上的
 * 退化成纯文字——总好过整串只有一个按钮、点下去永远只有第一个人。
 */
function artistParts(track: Track): { id: number; name: string }[] {
  const refs = track.artistRefs ?? []
  const names = track.artist
    .split(/[/\u3001&]|\sfeat\.?/i)
    .map((part) => part.trim())
    .filter(Boolean)
  if (names.length <= 1) return refs
  return names.map((name) => {
    const hit = refs.find((ref) => ref.name === name)
    return { id: hit?.id ?? 0, name }
  })
}

/**
 * 这一行亮不亮心。
 *
 * 合并行的主行只是「优先级最高的那一版」，用户可能喜欢的是挂在后面另一家的
 * 那一版；只看主行会让心形明明收藏过却还是空的，所以整行任一版本喜欢过都算亮。
 */
function likedRow(track: Track, likedIds: ReadonlySet<string>): boolean {
  if (likedIds.has(track.id)) return true
  return (track.versions ?? []).some((version) => likedIds.has(version.id))
}

export interface TrackMenuRequest {
  track: Track
  x: number
  y: number
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
  const currentRow = useRef<HTMLDivElement | null>(null)
  /*
   * 每一行右侧那颗心。收藏页、歌单、搜索结果、平台歌单都是同一份列表组件，
   * 所以「能不能喜欢」在这里做一次，所有列表就地都有了收藏键。
   */
  const likedIds = useLikedIds()
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
    currentRow.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
  }, [currentId])

  const openMenu = (track: Track, x: number, y: number) => {
    onMenu?.({ track, x, y })
  }

  return (
    <div className="tracks" role="table" aria-label="歌曲">
      <div className="tracks__head" role="row">
        <span className="tracks__idx" role="columnheader">
          #
        </span>
        <span role="columnheader">标题</span>
        <span role="columnheader">艺术家</span>
        <span className="tracks__album" role="columnheader">
          专辑
        </span>
        <span className="tracks__time" role="columnheader">
          时长
        </span>
        <span role="columnheader" aria-label="操作" />
      </div>

      {tracks.map((track, index) => {
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
        const isLiked = likedRow(track, likedIds)
        return (
          <div
            key={track.id}
            role="row"
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

            <span className="tracks__idx" role="cell">
              {isCurrent ? (
                <span className={`eq${playing ? ' is-live' : ''}`} aria-label="正在播放">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <span className="tnum">{index + 1}</span>
              )}
            </span>
            <span className="trk__title" role="cell">
              <span className="trk__title-text">{track.title || '（无标题）'}</span>
              {platforms.map((platform) => (
                <span
                  key={platform}
                  className={`badge trk__src trk__src--${platform}`}
                  title={`来自${sourceLabelById(platform)}`}
                >
                  {sourceLabelById(platform)}
                </span>
              ))}
              {track.lossless ? <span className="badge" title={`${track.codec} 无损`}>FLAC</span> : null}
            </span>
            <span className="trk__muted" role="cell">
              {refs.artist ? (
                artistParts(track).length > 1 ? (
                  // 一行挂着几个歌手就是几张艺人页，逐个能点。
                  <span className="trk__artists">
                    {artistParts(track).map((person, index) => (
                      <span key={`${person.id}:${index}`}>
                        {index > 0 ? <span className="trk__sep">/</span> : null}
                        {person.id ? (
                        <button
                          className="trk__ref"
                          onClick={(event) => {
                            // 行本身是一整块播放热区，名字要跳页就得自己截住这次点击。
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
                track.artist
              )}
            </span>
            <span className="trk__muted tracks__album" role="cell" title={track.album}>
              {refs.album ? (
                <button
                  className="trk__ref"
                  onClick={(event) => {
                    event.stopPropagation()
                    openOnlineAlbum(track.source ?? '', refs.album as number)
                  }}
                  title={`去《${track.album}》`}
                >
                  {track.album}
                </button>
              ) : (
                track.album
              )}
            </span>
            <span className="tracks__time tnum" role="cell">
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
                  /*
                   * 一行里有两个以上落点时先问收藏到哪儿；只有一个时直接切换。
                   * 菜单从按钮左上弹出，靠近哪边由 LikeMenu 自己夹进视口。
                   */
                  const targets = likeTargets(track)
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
                  if (!target || !target.writable) {
                    showFlash('这首歌所在的平台还没有收藏接口')
                    return
                  }
                  void toggleLiked(target.track).then((result) => {
                    if (!result.ok) {
                      if (result.message) showFlash(result.message)
                    } else {
                      showFlash(result.liked ? '已收藏到' + target.label : '已从' + target.label + '取消')
                    }
                  })
                }}
                title={isLiked ? '取消喜欢' : '喜欢'}
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

      {tracks.length === 0 ? (
        <div className="tracks__empty">
          <Note size={18} />
          没有匹配的歌曲
        </div>
      ) : null}
    </div>
  )
}
