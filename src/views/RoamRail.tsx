import { dropSeed, endRoam, hideRoamTrack, undoDrop, useRoam, useRoamProgress } from '../features/player/roam-session'
import { usePlayer } from '../features/player/store'
import { Close } from '../ui/icons'

/**
 * 漫游状态条。
 *
 * 这里原本排着这一趟的全部曲目，后来发现是重复的：漫游换的就是播放队列，右边
 * 那个队列面板里已经是同一批歌，两处并排摆着只是同一份列表画了两遍。所以这一条
 * 只留队列上没有的东西——走到第几首、从哪首出发、退出，以及「不再推」这颗
 * 只对当前歌生效的动作。
 *
 * 手动的「再要 N 首」和「跳过这首」都撤了：切歌本身就会触发补池，队列里那首
 * 不想听按下一首就行——两颗按钮各自只是同一件事的第二种说法。
 *
 * 为什么不做成页面：漫游开始时人就在播放页，列表已经交给队列面板，再跳一次页面
 * 就回到以前的漫游页了。
 */
export function RoamRail() {
  const tracks = useRoam((state) => state.tracks)
  const error = useRoam((state) => state.error)
  const dropped = useRoam((state) => state.dropped)
  const seed = useRoam((state) => state.seed)
  const current = usePlayer((state) => state.current())
  const progress = useRoamProgress(current)

  if (tracks.length === 0) return null

  const inRoam = progress.index >= 0 && current !== null

  return (
    <section className="rr" aria-label="漫游状态">
      <span className="rr__live">
        <i className="rr__live-dot" aria-hidden="true" />
        漫游中
      </span>
      {/*
        从哪首出发。收起 × 只摘这行字，不重排这一趟——用户嫌的是占地方，
        不是要把已排好的队列换掉。
      */}
      {seed ? (
        <span className="rr__seed" title={`这一趟从〈${seed.title}〉出发，按同专辑、同艺人往外扩`}>
          <span className="rr__seed-name">从〈{seed.title}〉出发</span>
          <button type="button" className="rr__seed-x" onClick={dropSeed} aria-label="收起「从这首出发」">
            <Close size={10} />
          </button>
        </span>
      ) : null}

      {/*
        原生客户端的漫游不报总数：它是一条流，没有「一共几首」。这里跟着只报
        已听几首——报总数会让一条流看起来像一份歌单，切久了那个数还会一直涨。
      */}
      <span className="rr__count">
        {inRoam ? `已听 ${progress.heard} 首` : '不在这一趟里'}
      </span>

      <div className="rr__acts">
        {/*
          只留一颗：不再推会写进名单（上限 300 首），跟「这一次先不听」是两回事；
          后者按下一首就够了，不必再摆一颗效果一样的按钮。
        */}
        {inRoam && current ? (
          <button
            type="button"
            className="rr__act rr__act--no"
            onClick={() => hideRoamTrack(current, 'dislike')}
            title="不想再听这首，以后不再推"
          >
            <Close size={12} />
            不再推
          </button>
        ) : null}
        {/*
          结束的是「这一趟」，不是播放：队列不换、正在放的继续放，所以文案不能写成
          「退出」——按过的人会以为歌也该停。真正会变的是补池停下、循环模式还原。
        */}
        <button
          type="button"
          className="rr__exit"
          onClick={endRoam}
          title="这一趟到此为止：队列不换，正在放的继续放；循环模式还原成进漫游前的样子"
        >
          结束漫游
        </button>
      </div>

      {/* 划错了没有第二次机会（尤其「不再推」是写进名单的），所以留三秒撤回。 */}
      {dropped ? (
        <p className="rr__undo">
          已{dropped.reason === 'skip' ? '跳过' : '不再推'}〈{dropped.track.title}〉
          <button type="button" onClick={undoDrop}>
            撤销
          </button>
        </p>
      ) : null}

      {error ? <p className="rr__note">{error}</p> : null}
    </section>
  )
}
