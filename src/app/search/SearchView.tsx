import { useCallback, useEffect } from 'react'
import { useLibrary } from '../../features/library/store'
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

  const tracks = useLibrary((s) => s.tracks)
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

  const submit = useCallback(() => {
    void useSearch.getState().submit(tracks)
  }, [tracks])

  const switchTo = (next: string) => {
    useSearch.getState().setSource(next)
    // 本机也是边打边出，所以换范围要重跑一次，不然同一个词会看到上一次的答案。
    void useSearch.getState().submit(tracks)
  }

  const showEmpty = submitted && !searching && rows.length === 0

  return (
    <div className="col srch">
      <header className="rh-sec__head">
        <h3>在哪儿找</h3>
        <span className="srch__hint">
          {active?.remote ? '在线范围要按回车，本机范围边打边出' : '只在这台电脑已有的文件里找'}
        </span>
      </header>

      <div className="srch__chips" role="tablist" aria-label="搜索范围">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={source === tab.id}
            className={`srch-chip${source === tab.id ? ' is-on' : ''}`}
            onClick={() => switchTo(tab.id)}
            title={tab.note}
          >
            {tab.label}
            {/* 只有已经答过的范围才配数字，免得 0 被读成「问过了没有」。 */}
            {submitted && source === tab.id ? (
              <em className="tnum">{rows.length}</em>
            ) : (results[tab.id]?.length ?? 0) > 0 ? (
              <em className="tnum">{results[tab.id]?.length}</em>
            ) : null}
          </button>
        ))}
        <button className="rh-btn" onClick={submit} disabled={searching}>
          {searching ? '搜索中…' : '搜索'}
        </button>
      </div>

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
          <p className="pg-note">
            {active?.remote
              ? `在线搜索是向${active.label}发送一次请求，所以要点「搜索」或按回车。`
              : '本机搜索只在这台电脑已有的文件里找，边打边出结果。'}
          </p>
        </div>
      ) : !submitted && query.trim() ? (
        <div className="srch__empty">
          <h2>按回车搜索「{query.trim()}」</h2>
          <p className="pg-note">搜索{active?.label}需要联网，所以不会边打边搜。</p>
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
