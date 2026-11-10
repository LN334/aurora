import { dropSeed, endRoam, hideRoamTrack, pullRoamMore, ROAM_MORE, undoDrop, useRoam, useRoamProgress } from '../features/player/roam-session'
import { roamCandidates, useRoamPlatforms } from '../features/player/roam-sources'
import { usePlayer } from '../features/player/store'
import { Close, Next, Plus } from '../ui/icons'

/** 平台全名太长（「网易云音乐」），这里只留能分辨的那几个字。 */
function shortPlatform(name: string): string {
  // 「QQ 音乐」去掉「音乐」会剩一个尾空格，两个平台之间就成了「QQ  · 」两格。
  return name.replace(/\s*音乐$/, '')
}

/**
 * 漫游状态条。
 *
 * 这里原本排着这一趟的全部曲目，后来发现是重复的：漫游换的就是播放队列，右边
 * 那个队列面板里已经是同一批歌，两处并排摆着只是同一份列表画了两遍。所以这一条
 * 只留队列上没有的东西——走到第几首、从哪首出发、向哪几家要、再要一批、退出，
 * 以及「跳过这首 / 不再推」这两颗只能对当前歌生效的动作。
 *
 * 为什么不做成页面：漫游开始时人就在播放页，列表已经交给队列面板，再跳一次页面
 * 就回到以前的漫游页了。
 */
export function RoamRail() {
  const tracks = useRoam((state) => state.tracks)
  const pulling = useRoam((state) => state.pulling)
  const error = useRoam((state) => state.error)
  const dropped = useRoam((state) => state.dropped)
  const seed = useRoam((state) => state.seed)
  const chosen = useRoamPlatforms()
  const current = usePlayer((state) => state.current())
  const progress = useRoamProgress(current)

  if (tracks.length === 0) return null

  const candidates = roamCandidates()
  const chosenSet = new Set(chosen)
  const inRoam = progress.index >= 0 && current !== null
  const wantMore = ROAM_MORE

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

      <span className="rr__count">
        {inRoam ? `第 ${progress.index + 1} 首` : '不在这一趟里'}
        <span className="rr__sep">·</span>
        已听 {progress.heard} / 共 {progress.total}
      </span>

      {/*
        只报设置里的勾选，这里不给开关。以前这排是能点的，改的其实也是设置里同一份，
        但摆在漫游轨上就像漫游自有第二套配置——同一个问题两个答案。要改去设置。
      */}
      <div className="rr__plats" role="note" aria-label="这一趟按设置里的推荐来源要">
        <span className="rr__plats-k">推流</span>
        <span className="rr__plats-v">
          {chosen.length > 0
            ? candidates
                .filter((item) => chosenSet.has(item.id))
                .map((item) => shortPlatform(item.name))
                .join(' · ')
            : '设置里一家都没勾'}
        </span>
      </div>

      <div className="rr__acts">
        {/*
          两颗只对当前这首生效。跳过不留痕，不再推会进名单——两者分开，混成一个
          动作名单会越攒越大，最后推什么都不对。
        */}
        {inRoam && current ? (
          <>
            <button
              type="button"
              className="rr__act"
              onClick={() => hideRoamTrack(current, 'skip')}
              title="跳过这首，只跳过这一次"
            >
              <Next size={12} />
              跳过这首
            </button>
            <button
              type="button"
              className="rr__act rr__act--no"
              onClick={() => hideRoamTrack(current, 'dislike')}
              title="不想再听这首，以后不再推"
            >
              <Close size={12} />
              不再推
            </button>
          </>
        ) : null}
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
