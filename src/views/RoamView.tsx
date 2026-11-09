import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { sourcesOf, trackKey } from '../features/online/unify'
import { player } from '../features/player/actions'
import { buildRoamQueue, loadRoamPool, loadRoamStream } from '../features/player/roam'
import { roamCandidates, roamPlatforms, setRoamPlatform, useRoamPlatforms } from '../features/player/roam-sources'
import { usePlayer } from '../features/player/store'
import { sourceOrder } from '../features/settings/source-order'
import { Shuffle } from '../ui/icons'
import { SkeletonRows } from '../ui/Skeleton'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import type { Track } from '../types'

const SOURCES: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
  kugou: '酷狗',
  qishui: '汽水'
}

/** 一次摆出来的一批。池子可能几百首，一次摊开就又成了「从现有里挑」。 */
interface Batch {
  tracks: Track[]
  /** 池子里一共多少首，用来说清这批是从多大范围里挑的。 */
  poolSize: number
}

/**
 * 漫游。
 *
 * 只放「还没收过的」：各平台每天按账号口味推的，加上私人漫游续出来的。收藏过、
 * 听过、本机有的都不进列表——那些歌本来就在库里，随机一遍只是换个顺序。
 *
 * 进页面先摆一批出来，点任何一行都从那里开始。「重新洗牌」换顺序（内容不变），
 * 「再来一批没听过的」向平台要新歌（内容变了，接在后面）。
 */
export function RoamView({
  onNavigate,
  onMenu
}: {
  onNavigate(route: ShellRoute): void
  onMenu(request: TrackMenuRequest): void
}) {
  const [batch, setBatch] = useState<Batch | null>(null)
  const [busy, setBusy] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [note, setNote] = useState('')
  const chosen = useRoamPlatforms()
  const candidates = useMemo(() => roamCandidates(), [])
  const chosenKey = chosen.join(',')
  const currentId = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index]?.id ?? null) : null))
  const playing = usePlayer((state) => state.playing)
  const order = useMemo(() => sourceOrder(), [])

  /*
   * 每次要批都发一个号。勾选连点两下、或者正在要的时候换了平台，会有两次请求
   * 同时在飞；先发的后回来就会把新的那批盖掉。回来时对一下号，不是最新的就丢掉。
   */
  const seq = useRef(0)

  const roll = useCallback(async () => {
    const mine = ++seq.current
    setBusy(true)
    try {
      const pool = await loadRoamPool(roamPlatforms())
      if (mine !== seq.current) return
      setBatch({ tracks: buildRoamQueue(pool), poolSize: pool.tracks.length })
      setNote('')
    } catch (error) {
      if (mine !== seq.current) return
      // 一家平台挂了不该让整页停在「正在要」：把原因说出来，别留一块空白。
      setNote('这一批没要到：' + (error instanceof Error ? error.message : String(error)))
      setBatch((prev) => prev ?? { tracks: [], poolSize: 0 })
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }, [])

  // 勾选变了就重新要：勾掉的平台不该还留在列表里。
  useEffect(() => {
    void roll()
  }, [roll, chosenKey])

  /**
   * 再要一批。
   *
   * 这两件事要一起做：新歌进列表（看得见）与进播放队列（听得见）。只进列表的话
   * 点「开始漫游」会从头重放；只进队列的话列表和实际队列对不上。已经在播时追加
   * 到队尾，正在放的那首不中断。
   */
  const pull = useCallback(async () => {
    const mine = seq.current
    setPulling(true)
    try {
      const more = await loadRoamStream(6, roamPlatforms())
      // 要的途中换了平台或重洗了牌，这一批补到旧列表上就是错的。
      if (mine !== seq.current) return
      const seen = new Set((batch?.tracks ?? []).map((track) => trackKey(track)))
      const rows = more.filter((track) => !seen.has(trackKey(track)))
      if (rows.length === 0) {
        setNote('平台这一批和手上重复了，过一会儿再试')
        return
      }
      setNote('')
      setBatch((prev) =>
        prev ? { tracks: [...prev.tracks, ...rows], poolSize: prev.poolSize + rows.length } : prev
      )
      player.addToQueue(rows, 'end')
    } finally {
      // 补的这批作废了也得把按钮放开，否则「再来一批」会一直转。
      setPulling(false)
    }
  }, [batch])

  const spread = useMemo(() => {
    const out: Record<string, number> = {}
    for (const track of batch?.tracks ?? []) {
      for (const key of sourcesOf(track, order)) out[key] = (out[key] ?? 0) + 1
    }
    return out
  }, [batch, order])

  /*
   * 要齐四个平台的推荐要几秒。空着等的时候整页只有一行小字，看起来像没打开；
   * 先按列表版式铺一层行占位，第一批到了直接填进去。
   */
  if (batch === null) {
    return (
      <div className="col">
        <div className="roam__srcs">
          <span className="roam__label">推流平台</span>
          {candidates.map((item) => (
            <button
              key={item.id}
              className={'chip' + (chosen.includes(item.id) ? ' is-active' : '')}
              type="button"
              onClick={() => setRoamPlatform(item.id, !chosen.includes(item.id))}
            >
              {item.name}
            </button>
          ))}
        </div>
        <header className="rh-sec__head roam__head">
          <span className="pl-head__count">正在向各平台要今天这一批…</span>
        </header>
        <SkeletonRows count={12} />
      </div>
    )
  }

  if (batch.tracks.length === 0) {
    return (
      <div className="pg-empty">
        <h2>{chosen.length === 0 ? '一个推流平台都没勾' : '勾的平台今天还没推过来'}</h2>
        <p>
          {chosen.length === 0
            ? '漫游只放平台推的，下面把要用哪几家勾上。'
            : '收藏过的、听过的不算漫游。换几家勾，或者稍等一下再要。'}
        </p>
        <div className="roam__srcs">
          {candidates.map((item) => (
            <button
              key={item.id}
              className={'chip' + (chosen.includes(item.id) ? ' is-active' : '')}
              type="button"
              onClick={() => setRoamPlatform(item.id, !chosen.includes(item.id))}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="roam__acts">
          <button className="rh-btn rh-btn--main" type="button" onClick={() => void roll()} disabled={busy}>
            {busy ? '正在要…' : '再要一次'}
          </button>
          <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'me' })}>
            去「我」里看看
          </button>
        </div>
      </div>
    )
  }

  const parts = Object.entries(spread).map(
    ([key, count]) => (key === 'local' ? '本机' : (SOURCES[key] ?? key)) + ' ' + count
  )
  const tracks = batch.tracks

  return (
    <div className="col">
      <div className="roam__srcs">
        <span className="roam__label">推流平台</span>
        {candidates.map((item) => (
          <button
            key={item.id}
            className={'chip' + (chosen.includes(item.id) ? ' is-active' : '')}
            type="button"
            onClick={() => setRoamPlatform(item.id, !chosen.includes(item.id))}
          >
            {item.name}
          </button>
        ))}
        {chosen.length < candidates.length ? (
          <button
            className="roam__all"
            type="button"
            onClick={() => {
              for (const item of candidates) setRoamPlatform(item.id, true)
            }}
          >
            全选
          </button>
        ) : null}
      </div>
      <header className="rh-sec__head roam__head">
        <span className="pl-head__count">
          {tracks.length} 首
          {batch.poolSize > tracks.length ? ' · 从 ' + batch.poolSize + ' 首里挑的' : ''}
          {parts.length > 0 ? ' · ' + parts.join(' · ') : ''}
          {note ? ' · ' + note : ''}
        </span>
        <span className="roam__acts">
          <button className="rh-btn rh-btn--main" type="button" onClick={() => player.playQueue(tracks, 0)}>
            <Shuffle size={13} />
            开始漫游
          </button>
          <button className="rh-btn" type="button" onClick={() => void pull()} disabled={pulling}>
            {pulling ? '正在要新歌…' : '再来一批没听过的'}
          </button>
          <button className="rh-btn" type="button" onClick={() => void roll()} disabled={busy}>
            {busy ? '正在洗…' : '重新洗牌'}
          </button>
        </span>
      </header>
      <TrackList
        tracks={tracks}
        currentId={currentId}
        playing={playing}
        onPlayAt={(index) => player.playQueue(tracks, index)}
        onMenu={onMenu}
      />
    </div>
  )
}
