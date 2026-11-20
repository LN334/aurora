import { useMemo, useState } from 'react'
import type { Track } from '../../types'
import type { PlayMode } from '../../features/player/mode'
import { usePlayer } from '../../features/player/store'
import { useRoam } from '../../features/player/roam-session'
import { trackKey } from '../../features/online/unify'
import { toggleLiked, useLikedIds } from '../../features/favorites/likes'
import { likeTargets } from '../../features/favorites/like-targets'
import { useLikeMenu } from '../../features/favorites/like-menu'
import { showFlash } from '../../ui/flash'
import { Heart } from '../../ui/icons'
import { DesktopLyrics, Expand, Queue, Sliders, User } from '../../ui/icons'
import { ControlButton } from './ControlButton'
import { Progress } from './Progress'
import { QualityMenu } from './QualityMenu'
import { TrackInfo } from './TrackInfo'
import { Transport } from './Transport'
import { Volume } from './Volume'

interface PlayerBarProps {
  track: Track | null
  playing: boolean
  loading: boolean
  duration: number
  volume: number
  muted: boolean
  mode: PlayMode
  eqOpen: boolean
  desktopLyricsOpen: boolean
  queueLength: number
  onToggle(): void
  onNext(): void
  onPrev(): void
  onSeekRatio(ratio: number): void
  onVolume(volume: number): void
  onToggleMute(): void
  onCycleMode(): void
  /** 点封面进「正在播放」；舞台是另一页，走它自己的键与按钮。 */
  onOpenNow(): void
  onOpenStage(): void
  onToggleEq(): void
  onOpenQueue(): void
  onOpenParty(): void
  partyOpen: boolean
  onToggleDesktopLyrics(): void
}

/**
 * 播放底栏：左边「在放什么」，中间「怎么放」，右边「界面怎么显示」。
 *
 * 三块的分工是先定的，组件只是照着切：
 *
 * - 左（TrackInfo）只读：封面、标题、艺人。点封面进沉浸模式。
 * - 中（Transport + Progress）只管播放：上一首 / 播放 / 下一首是主键，
 *   左侧一颗键管「顺序 / 列表 / 单曲 / 随机」；下面一行是时间、进度、总时长。
 * - 右（视图键 + Volume）只管「看得见的东西」：桌面歌词、队列、调音台、舞台，
 *   再加一条分隔线之后的音量。视图键与音量不是一个层级，靠这条线分开。
 *
 * 响应式也照这三块走，见 styles/player.css：先收音量滑条（静音键与键盘仍在），
 * 再在窄窗口把进度条挪到第二行、横贯整条——不靠缩小图标硬挤。
 */
export function PlayerBar({
  track,
  playing,
  loading,
  duration,
  volume,
  muted,
  mode,
  eqOpen,
  desktopLyricsOpen,
  queueLength,
  onToggle,
  onNext,
  onPrev,
  onSeekRatio,
  onVolume,
  onToggleMute,
  onCycleMode,
  onOpenNow,
  onOpenStage,
  onToggleEq,
  onOpenQueue,
  onOpenParty,
  partyOpen,
  onToggleDesktopLyrics
}: PlayerBarProps) {
  // 漫游里播放模式没有可改的东西，底栏跟播放页一起把它收起来。
  const roaming = useRoam((state) => state.tracks.length > 0)
  /*
   * 底栏也能收藏。
   *
   * 播放页那颗心离手太远：听到一半想收藏，得先点进播放页再退回来。这里与
   * 播放页走同一套规则——一个落点直接写，挂着两家版本时弹菜单问落到哪儿。
   */
  /* 倍速是全局功能，底栏也得有——它不该只藏在播放页里。 */
  const rate = usePlayer((state) => state.playbackRate)
  const likedIds = useLikedIds()
  const targets = useMemo(() => (track ? likeTargets(track) : []), [track])
  const liked = track ? likedIds.has(trackKey(track)) : false
  /*
   * 点赞要当场有反应。
   *
   * 原来的反馈只有页面顶那条 flash，而按钮长在底栏最右——人点完眼睛还盯着这里，
   * 上面飘过一句话等于没看见。这里补一个心跳动画，写盘成不成功都先弹一下。
   */
  const [likePop, setLikePop] = useState(false)
  const handleLike = (event: React.MouseEvent<HTMLButtonElement>): void => {
    setLikePop(true)
    /*
     * 自己复位，不靠 animationend。
     *
     * 挂上 is-pop 之后如果动画没跑（元素被隐藏、系统开了减少动效、或者这一帧
     * 正好在重渲染），animationend 永远不来，is-pop 就一直挂着——之后再点，
     * 类名没变，动画不会重播，看起来就是「第二次点没反应」。
     */
    window.setTimeout(() => setLikePop(false), 520)
    if (!track) return
    if (targets.length > 1) {
      const rect = event.currentTarget.getBoundingClientRect()
      useLikeMenu.getState().show({ track, x: rect.left, y: rect.bottom + 6 })
      return
    }
    const target = targets[0]
    const name = target?.label ?? '这一家'
    void toggleLiked(target?.track ?? track).then((result) => {
      if (!result.ok) {
        if (result.message) showFlash(result.message)
        return
      }
      showFlash(result.liked ? '已收藏到' + name : '已从' + name + '取消')
    })
  }

  return (
    <footer className="player">
      {/*
        两条带：上面一行放「在放什么 / 怎么放 / 看什么」，下面一整条是进度。
        进度以前缩在中间那一栏里，两边各留一大截空；铺满整条之后它才像一条
        时间轴，而不是中间那块控件下面的一根短尺。
      */}
      <div className="player__main">
        <TrackInfo track={track} onOpenNow={onOpenNow} />

        <div className="pb-core">
          <Transport
            playing={playing}
            loading={loading}
            disabled={!track}
            mode={mode}
            onToggle={onToggle}
            onNext={onNext}
            onPrev={onPrev}
            onCycleMode={onCycleMode}
            hideModes={roaming}
          />
        </div>

        <div className="pb-side">
        <ControlButton
          className="pb-opt"
          label="桌面歌词"
          tip="桌面歌词"
          hint="桌面歌词 (Ctrl+Alt+L)"
          active={desktopLyricsOpen}
          pressed={desktopLyricsOpen}
          onClick={onToggleDesktopLyrics}
        >
          <DesktopLyrics size={17} />
        </ControlButton>
        <ControlButton
          label="播放队列"
          tip="播放队列"
          /*
           * 漫游里不挂这个数。它是一条一直往下的流，不是「23 首的一份歌单」；
           * 右上角挂个数字，等于把流说成了列表。
           */
          badge={roaming ? 0 : queueLength}
          onClick={onOpenQueue}
        >
          <Queue size={17} />
        </ControlButton>
        <ControlButton
          className="pb-opt"
          label="一起听"
          tip="一起听"
          hint="一起听"
          active={partyOpen}
          pressed={partyOpen}
          onClick={onOpenParty}
        >
          <User size={17} />
        </ControlButton>
        {/* 视图类（歌词/队列/一起听）与调音类（调音台/舞台）之间收一道缝。 */}
        <span className="pb-sep" aria-hidden="true" />
        <ControlButton
          label="调音台"
          tip="调音台"
          hint="调音台 (E)"
          active={eqOpen}
          pressed={eqOpen}
          onClick={onToggleEq}
        >
          <Sliders size={17} />
        </ControlButton>
        <ControlButton
          className="pb-opt"
          label="舞台"
          tip="舞台"
          hint="舞台 (L)"
          disabled={!track}
          onClick={onOpenStage}
        >
          <Expand size={17} />
        </ControlButton>
        <button
          type="button"
          className={`pb-rate${rate === 1 ? '' : ' is-on'}`}
          data-tip="播放速度"
          aria-label={`播放速度 ${rate} 倍`}
          onClick={() => {
            const rates = [0.75, 1, 1.25, 1.5, 2]
            const at = rates.indexOf(rate)
            usePlayer.getState().setPlaybackRate(rates[(at + 1) % rates.length] ?? 1)
          }}
        >
          {rate}×
        </button>
        <ControlButton
          className={likePop ? 'is-pop' : ''}
          label={liked ? '取消喜欢' : '喜欢'}
          tip={liked ? '已喜欢' : '喜欢'}
          active={liked}
          pressed={liked}
          disabled={!track}
          onClick={handleLike}
        >
          <Heart size={17} />
        </ControlButton>

        <QualityMenu />

        <span className="pb-sep" aria-hidden="true" />

          <Volume volume={volume} muted={muted} onVolume={onVolume} onToggleMute={onToggleMute} />
        </div>
      </div>

      <Progress duration={duration} disabled={!track} onSeekRatio={onSeekRatio} />
    </footer>
  )
}
