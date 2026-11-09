import { useEffect, useRef } from 'react'
import { player } from '../features/player/actions'
import {
  endRoam,
  hideRoamTrack,
  pullRoamMore,
  ROAM_MORE,
  useRoam,
  useRoamProgress
} from '../features/player/roam-session'
import { roamCandidates, setRoamPlatform, useRoamPlatforms } from '../features/player/roam-sources'
import { usePlayer } from '../features/player/store'
import { sourceLabelFor } from '../features/online/registry'
import { trackKey } from '../features/online/unify'
import { artworkFor } from '../features/library/source'
import { Artwork } from '../ui/Artwork'
import { Close, Note, Plus } from '../ui/icons'

/** 平台全名太长（「网易云音乐」），轨道头上只留能分辨的那几个字。 */
function shortPlatform(name: string): string {
  return name.replace(/音乐$/, '')
}

/**
 * 漫游轨：一趟漫游的全部曲目，横排一条。
 *
 * 它是这一页的一部分，不是另一个页面——漫游开始时人已经在播放页了，列表如果
 * 还得再跳一次，那和以前的漫游页没有区别。所以轨道只占底部一条，封面、歌词、
 * 进度都还在原位。
 *
 * 轨道上做四件在别处做不了的事：
 *
 * 1. 跳到这一趟里的任意一首。点卡片就播，不重开一趟。
 * 2. 划掉。点卡片右上角的 ×：从这一趟里拿掉，同时记住，下次要歌不再推它。
 * 3. 再要一批。尾部那张卡向平台再要半批接在末尾，不打断正在放的这首。
 * 4. 就地换平台。头部四颗开关就是「从哪几家要」，改完下一批立刻照新的要。
 *
 * 「已听」不做成历史记录：它只服务两个地方——头部那行字，以及万一这一趟被
 * 别的页面顶掉之后再点漫游，知道该从哪一首接着放。
 */
export function RoamRail() {
  const tracks = useRoam((state) => state.tracks)
  const heard = useRoam((state) => state.heard)
  const pulling = useRoam((state) => state.pulling)
  const error = useRoam((state) => state.error)
  const chosen = useRoamPlatforms()
  const current = usePlayer((state) => state.current())
  const progress = useRoamProgress(current)
  const nowKey = current ? trackKey(current) : ''
  const nowRef = useRef<HTMLLIElement | null>(null)

  // 「已听」与「放过」由 roam-session 在切歌时统一记，不挂在组件上——
  // 这一页被别的页面顶掉时，这一趟照样要走下去。

  // 当前卡自动回到视线中间。换歌、划掉、接新一批都会走到这里。
  useEffect(() => {
    if (!nowKey) return
    nowRef.current?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [nowKey])

  if (tracks.length === 0) return null

  const candidates = roamCandidates()
  const chosenSet = new Set(chosen)
  const wantMore = ROAM_MORE

  return (
    <section className="rr" aria-label="漫游轨">
      <header className="rr__head">
        <span className="rr__live">
          <i className="rr__live-dot" aria-hidden="true" />
          漫游中
        </span>
        <span className="rr__count">
          {progress.index >= 0 ? `第 ${progress.index + 1} 首` : '不在这一趟里'}
          <span className="rr__sep">·</span>
          已听 {progress.heard} / 共 {progress.total}
        </span>

        <div className="rr__plats" role="group" aria-label="这一趟从哪几家要">
          <span className="rr__plats-k">推流</span>
          {candidates.map((item) => {
            const on = chosenSet.has(item.id)
            return (
              <button
                key={item.id}
                type="button"
                className={`rr__plat${on ? ' is-on' : ''}`}
                aria-pressed={on}
                title={on ? `不再向${item.name}要` : `下一批也向${item.name}要`}
                onClick={() => setRoamPlatform(item.id, !on)}
              >
                {shortPlatform(item.name)}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          className="rr__more"
          onClick={() => void pullRoamMore()}
          disabled={pulling}
          title={`再接 ${wantMore} 首到末尾，正在放的这首不打断`}
        >
          <Plus size={13} />
          {pulling ? '正在要…' : `再要 ${wantMore} 首`}
        </button>
        <button type="button" className="rr__exit" onClick={endRoam} title="收起轨道，继续放当前的">
          退出漫游
        </button>
      </header>

      <ol className="rr__rail">
        {tracks.map((track, index) => {
          const key = trackKey(track)
          const isNow = key === nowKey
          const isHeard = Boolean(heard[key])
          const source = sourceLabelFor(track) ?? '本机'
          return (
            <li
              key={key}
              ref={isNow ? nowRef : undefined}
              className={`rr__card${isNow ? ' is-now' : ''}${isHeard && !isNow ? ' is-heard' : ''}`}
            >
              <button
                type="button"
                className="rr__pick"
                onClick={() => player.playQueue(tracks, index)}
                title={`${track.title} · ${track.artist || '未知艺人'}`}
              >
                <span className="rr__art">
                  <Artwork src={artworkFor(track)} fallback={<Note size={16} />} />
                </span>
                <span className="rr__body">
                  <span className="rr__title">{track.title}</span>
                  <span className="rr__sub">
                    <span className="rr__src">{source}</span>
                    {track.artist || '未知艺人'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="rr__drop"
                onClick={() => hideRoamTrack(track)}
                title="划掉这首，以后不再推"
                aria-label={`划掉 ${track.title}`}
              >
                <Close size={11} />
              </button>
            </li>
          )
        })}

        <li className="rr__tail">
          <button
            type="button"
            className="rr__again"
            onClick={() => void pullRoamMore()}
            disabled={pulling}
          >
            <Plus size={15} />
            <span>{pulling ? '正在要…' : '再来一批'}</span>
          </button>
        </li>
      </ol>

      {error ? <p className="rr__note">{error}</p> : null}
    </section>
  )
}
