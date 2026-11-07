import { useEffect, useMemo } from 'react'
import { searchLocalTracks } from '../../features/library/search'
import { player } from '../../features/player/actions'
import type { Track } from '../../types'
import { ChevronRight, Close } from '../../ui/icons'
import { TrackList, type TrackMenuRequest } from '../../ui/TrackList'
import { searchResultsFor, searchSources, useSearch } from './store'
import './QuickSearch.css'

/**
 * 顶栏那个框自己出结果。
 *
 * 以前点它只是跳去搜索页，跳过去还要再按一次「搜索」——等于一个框套一个页面，
 * 中间多了一步谁也不需要的换页。现在文字在原地打字、回车就在框下面出结果，
 * 想要范围标签或看全部，才点页脚进搜索页。
 */
interface QuickSearchProps {
  open: boolean
  /** 本机曲库。本机范围边打边出，过滤的是内存里这份列表。 */
  localTracks: Track[]
  currentId: string | null
  playing: boolean
  onMenu(request: TrackMenuRequest): void
  onClose(): void
  /** 进搜索页看全部（那里才有范围标签）。 */
  onSeeAll(): void
}

export function QuickSearch({
  open,
  localTracks,
  currentId,
  playing,
  onMenu,
  onClose,
  onSeeAll
}: QuickSearchProps) {
  const query = useSearch((s) => s.query)
  const source = useSearch((s) => s.source)
  const searching = useSearch((s) => s.searching)
  const submitted = useSearch((s) => s.submitted)
  const error = useSearch((s) => s.error)
  const results = useSearch((s) => s.results)

  const tabs = searchSources()
  const active = tabs.find((tab) => tab.id === source) ?? tabs[0]
  const stored = searchResultsFor({ source, results })
  const trimmed = query.trim()

  /*
   * 本机范围边打边出：过滤一份已经在内存里的列表不花钱。
   * 在线范围每敲一个字发一次请求既慢又没必要，所以那边等回车。
   */
  const rows = useMemo(() => {
    if (source === 'local' && !submitted) return trimmed ? searchLocalTracks(localTracks, trimmed) : []
    return stored
  }, [source, submitted, trimmed, localTracks, stored])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // 外壳的 Esc 也管面板与返回，这里先吃掉，免得一次关两层。
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const waiting = !submitted && active?.remote === true
  const settled = submitted || (source === 'local' && trimmed.length > 0)

  return (
    <div className="qs" role="presentation" onPointerDown={onClose}>
      <div
        className="qs__panel"
        role="dialog"
        aria-label="搜索结果"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="qs__head">
          <span className="qs__scope">结果来自：{active?.label ?? '本机曲库'}</span>
          <span className="qs__count tnum">
            {searching ? '搜索中…' : rows.length > 0 ? rows.length + ' 首' : ''}
          </span>
          <button className="qs__close" onClick={onClose} title="关闭" aria-label="关闭">
            <Close size={15} />
          </button>
        </header>

        {error ? <p className="qs__note qs__note--warn">{error}</p> : null}

        {!error && waiting ? (
          <p className="qs__note">
            {trimmed
              ? '按回车，让' + (active?.label ?? '在线平台') + '去找「' + trimmed + '」'
              : '敲几个字，回车开始搜'}
          </p>
        ) : null}

        {!error && settled && !searching && rows.length === 0 ? (
          <p className="qs__note">没有找到「{trimmed}」</p>
        ) : null}

        {rows.length > 0 ? (
          <div className="qs__body">
            <TrackList
              tracks={rows}
              currentId={currentId}
              playing={playing}
              onPlayAt={(index) => player.playQueue(rows, index)}
              onMenu={onMenu}
            />
          </div>
        ) : null}

        <footer className="qs__foot">
          <button className="rh-more" onClick={onSeeAll}>
            在搜索页里看全部
            <ChevronRight size={13} />
          </button>
        </footer>
      </div>
    </div>
  )
}
