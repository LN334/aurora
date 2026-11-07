import { useEffect } from 'react'
import { player } from '../../features/player/actions'
import { usePlayer } from '../../features/player/store'
import { TrackList, type TrackMenuRequest } from '../../ui/TrackList'
import type { Track } from '../../types'
import { searchResultsFor, searchSources, useSearch } from '../search/store'

/**
 * 搜索页：一个词，挑一个范围，只从那个范围里出结果。
 *
 * 范围切片来自音源注册表，所以这里不点名任何平台——多注册一个平台就多一颗
 * 切片，不必改这个文件。两种范围的返回都是同一个 Track 形状，因此一张列表
 * 就能渲染全部，播放器也不用为谁开特例。
 */
export function SearchView({ onMenu }: { onMenu(request: TrackMenuRequest): void }) {
  const query = useSearch((s) => s.query)
  const source = useSearch((s) => s.source)
  const searching = useSearch((s) => s.searching)
  const submitted = useSearch((s) => s.submitted)
  const error = useSearch((s) => s.error)
  const results = useSearch((s) => s.results)

  const currentTrack = usePlayer((s) => (s.index >= 0 ? (s.queue[s.index] ?? null) : null))
  const playing = usePlayer((s) => s.playing)

  // 打开这一页时才决定范围；store 自己决定不了，导入顺序里没有这个信息。
  useEffect(() => {
    useSearch.getState().resolveSource()
  }, [])

  const tabs = searchSources()
  const active = tabs.find((tab) => tab.id === source) ?? tabs[0]
  const rows = searchResultsFor({ source, results })
  const currentId = currentTrack?.id ?? null

  const showEmpty = submitted && !searching && rows.length === 0

  return (
    <div className="col srch">
      {error ? (
        <div className="notice notice--warn" role="status">
          {error}
        </div>
      ) : null}

      {searching ? (
        <p className="pg-note">正在搜索{active?.label}…</p>
      ) : showEmpty ? (
        <div className="srch__empty">
          <h2>{query.trim() ? `没有找到「${query.trim()}」` : '先输入要搜的内容'}</h2>
          {active?.remote ? <p className="pg-note">在线要按回车</p> : null}
        </div>
      ) : !submitted && query.trim() ? (
        <div className="srch__empty">
          <h2>按回车搜索「{query.trim()}」</h2>
        </div>
      ) : (
        <>
          {/*
            同时开着几个音源时，结果列表必须说清楚每行从哪来——只有一个在线
            平台时这是个已知缺口，现在由每行的来源标回答。
          */}
          {tabs.filter((tab) => tab.remote).length > 1 ? (
            <div className="srch__legend">结果来自：{active?.label}</div>
          ) : null}
          <TrackList
            tracks={rows as Track[]}
            currentId={currentId}
            playing={playing}
            onPlayAt={(index) => player.playQueue(rows as Track[], index)}
            onMenu={onMenu}
          />
        </>
      )}
    </div>
  )
}
