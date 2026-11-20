import { useMemo, useState } from 'react'
import type { Playlist } from '../features/playlists/store'
import type { PlaylistOrder } from '../features/library/views'
import type { Track } from '../types'
import { formatSpan, formatTime } from '../ui/format'
import { AlbumName, ArtistName } from '../ui/NameRef'
import { artworkFor } from '../features/library/source'
import { sourceLabelById } from '../features/online/registry'
import { Artwork } from '../ui/Artwork'
import { ShelfSearch } from '../ui/ShelfSearch'
import { FILTER_EVENT } from '../ui/filter-event'
import { filterPlaylistRows } from '../features/library/playlist-filter'
import { Note, Play, Trash, Wave } from '../ui/icons'
import { DetailHero } from './DetailHero'

interface PlaylistDetailProps {
  playlist: Playlist
  /** Resolved tracks, in playlist order. Files no longer in the library are absent. */
  tracks: Track[]
  missingCount: number
  currentId: string | null
  playing: boolean
  onPlayAt(index: number): void
  onMove(from: number, to: number): void
  onSort(order: PlaylistOrder): void
  onRemoveAt(index: number): void
  onExport(): void
  onRename(name: string): void
}

const SORTS: Array<[PlaylistOrder, string]> = [
  ['manual', '手动顺序'],
  ['added', '最近添加'],
  ['title', '标题'],
  ['artist', '艺人'],
  ['duration', '时长']
]

export function PlaylistDetailPage({
  playlist,
  tracks,
  missingCount,
  currentId,
  playing,
  onPlayAt,
  onMove,
  onSort,
  onRemoveAt,
  onExport,
  onRename
}: PlaylistDetailProps) {
  const [draft, setDraft] = useState(playlist.name)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  /*
   * 排序方式不存进歌单：存下来的就是排好的那份顺序，重开时「手动顺序」指的
   * 正是它。把排序方式也持久化会多一个状态，还得处理「改了排序但没保存」。
   */
  const [order, setOrder] = useState<PlaylistOrder>('manual')
  const [query, setQuery] = useState('')

  /*
   * 筛的是「看哪首」，不是「歌单里有哪首」：`filterPlaylistRows` 给每一行都带上
   * 原始下标，点一行播的还是那首，不会因为前面被筛掉而串位。
   *
   * 筛选期间把拖拽关掉 —— 在筛过的列表里把第 3 行拖到第 1 行，与「在歌单里
   * 把它移到最前」不是一回事，容易做成人没想到的操作。
   */
  const filtering = query.trim() !== ''
  const rows = useMemo(() => filterPlaylistRows(tracks, query), [tracks, query])

  const total = tracks.reduce((sum, track) => sum + track.duration, 0)

  const commitName = () => {
    const next = draft.trim()
    if (next && next !== playlist.name) onRename(next)
    else setDraft(playlist.name)
  }

  return (
    <div className="pl-detail">
      <DetailHero
        art={
          <Artwork
            src={artworkFor(tracks[0] ?? null)}
            alt=""
            fallback={<Note size={34} />}
          />
        }
        kicker="歌单"
        title={
          <input
            className="dp__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                setDraft(playlist.name)
                event.currentTarget.blur()
              }
            }}
            aria-label="歌单名字"
            maxLength={80}
          />
        }
        meta={
          <span>
            {tracks.length} 首{total > 0 ? ' · ' + formatSpan(total) : ''}
          </span>
        }
        actions={
          <>
            <button
              className="dbtn dbtn--main"
              type="button"
              onClick={() => onPlayAt(0)}
              disabled={tracks.length === 0}
            >
              <Play size={15} />
              播放全部
            </button>
            <button className="dbtn" type="button" onClick={onExport} disabled={tracks.length === 0}>
              导出 m3u
            </button>
          </>
        }
        stats={[
          { value: tracks.length, label: '曲目' },
          { value: total > 0 ? formatSpan(total) : '—', label: '时长' }
        ]}
      />

      {missingCount > 0 ? (
        <div className="pl-detail__warn">有 {missingCount} 个条目在曲库里找不到</div>
      ) : null}

      {tracks.length > 0 ? (
        <>
          <div className="pl-detail__sort">
            <div className="seg" role="group" aria-label="歌单顺序">
              {SORTS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={order === key ? 'is-active' : ''}
                  onClick={() => {
                    setOrder(key)
                    onSort(key)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="pl-detail__note">
              {filtering
                ? '筛选时不能改顺序，清空搜索就行'
                : '拖一行就能改顺序，或按住 Alt 用上下方向键'}
            </span>
          </div>
          <div className="lk-search">
            <ShelfSearch
          value={query}
          placeholder="在这个歌单里找"
          onChange={setQuery}
          listenEvent={FILTER_EVENT}
          hideTrigger
        />
            <span className="lk-search__count">
              {filtering ? `${rows.length} / ${tracks.length} 首` : `${tracks.length} 首`}
            </span>
          </div>
        </>
      ) : null}

      {tracks.length === 0 ? (
        <div className="empty">
          <div className="empty__art">
            <Wave size={30} />
          </div>
          <h2>这个播放列表还是空的</h2>
        </div>
      ) : rows.length === 0 ? (
        <p className="shelf-empty">没有匹配的歌。</p>
      ) : (
        <ol className="pl-tracks">
          {rows.map(({ track, index }) => {
            const isCurrent = track.id === currentId
            const classes = [
              'pl-track',
              isCurrent ? 'is-current' : '',
              !filtering && dragFrom === index ? 'is-dragging' : '',
              !filtering && dragOver === index && dragFrom !== index ? 'is-over' : ''
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <li
                key={`${track.id}-${index}`}
                className={classes}
                draggable={!filtering}
                onDragStart={(event) => {
                  setDragFrom(index)
                  event.dataTransfer.effectAllowed = 'move'
                  // Firefox and Chromium both require some payload to start a drag.
                  event.dataTransfer.setData('text/plain', String(index))
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDragOver(index)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const raw = event.dataTransfer.getData('text/plain')
                  const from = dragFrom ?? Number.parseInt(raw, 10)
                  if (Number.isFinite(from)) onMove(from, index)
                  setDragFrom(null)
                  setDragOver(null)
                }}
                onDragEnd={() => {
                  setDragFrom(null)
                  setDragOver(null)
                }}
              >
                <span className="pl-track__grip" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>

                <button
                  className="pl-track__main"
                  onClick={() => onPlayAt(index)}
                  onKeyDown={(event) => {
                    // Keyboard equivalent of dragging, so reordering is not
                    // mouse-only. Off while filtering, same as dragging.
                    if (filtering) return
                    if (!event.altKey) return
                    if (event.key === 'ArrowUp' && index > 0) {
                      event.preventDefault()
                      onMove(index, index - 1)
                    } else if (event.key === 'ArrowDown' && index < tracks.length - 1) {
                      event.preventDefault()
                      onMove(index, index + 1)
                    }
                  }}
                  title={`播放 ${track.title}（Alt + 上下方向键可调整顺序）`}
                >
                  <span className="pl-track__index tnum">{index + 1}</span>
                  <span className="pl-track__title">
                    {isCurrent && playing ? (
                      <span className="eq is-live" aria-label="正在播放">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : null}
                    <span className="pl-track__title-text">{track.title || '（无标题）'}</span>
                    {/* 歌单常把几家平台的歌混在一起，标题后标一下来源。 */}
                    {track.source && track.source !== 'local' ? (
                      <span className={`badge trk__src pl-track__src trk__src--${track.source}`}>
                        {sourceLabelById(track.source)}
                      </span>
                    ) : null}
                  </span>
                  <span className="pl-track__muted"><ArtistName track={track} /></span>
                  <span className="pl-track__muted pl-track__album"><AlbumName track={track} /></span>
                  <span className="pl-track__time tnum">{formatTime(track.duration)}</span>
                </button>

                <button
                  className="icon-btn pl-track__remove"
                  onClick={() => onRemoveAt(index)}
                  title="从这个列表里移除"
                  aria-label={`从播放列表移除 ${track.title}`}
                >
                  <Trash size={15} />
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
