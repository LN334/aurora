import { useEffect, useRef } from 'react'
import { sourceTagFor } from '../features/online/registry'
import { openOnlineAlbum, openOnlineArtist, refOfTrack } from '../features/refs/navigate'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { formatTime } from './format'
import { showFlash } from './flash'
import { Heart, Note } from './icons'
import type { Track } from '../types'

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
    tracks.map((track) => (Boolean(track.source) && track.source !== 'local' ? track.source : 'local'))
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
        const srcTag = sourceTagFor(track, mixed)
        const refs = refOfTrack(track)
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
              {srcTag ? (
                <span className={`badge trk__src trk__src--${srcTag.kind}`} title={`来自${srcTag.label}`}>
                  {srcTag.label}
                </span>
              ) : null}
              {track.lossless ? <span className="badge" title={`${track.codec} 无损`}>FLAC</span> : null}
            </span>
            <span className="trk__muted" role="cell">
              {refs.artist ? (
                <button
                  className="trk__ref"
                  onClick={(event) => {
                    // 行本身是一整块播放热区，名字要跳页就得自己截住这次点击。
                    event.stopPropagation()
                    openOnlineArtist(track.source ?? '', refs.artist as number)
                  }}
                  title={`去 ${track.albumArtist || track.artist} 的页面`}
                >
                  {track.artist}
                </button>
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
                className={`trk__like${likedIds.has(track.id) ? ' is-liked' : ''}`}
                onClick={(event) => {
                  event.stopPropagation()
                  void toggleLiked(track).then((result) => {
                    if (!result.ok && result.message) showFlash(result.message)
                  })
                }}
                title={likedIds.has(track.id) ? '取消喜欢' : '喜欢'}
                aria-label={`${likedIds.has(track.id) ? '取消喜欢' : '喜欢'} ${track.title}`}
                aria-pressed={likedIds.has(track.id)}
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
