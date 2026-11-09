import type { RepeatMode, Track } from '../../types'
import { DesktopLyrics, Expand, Queue, Sliders } from '../../ui/icons'
import { ControlButton } from './ControlButton'
import { Progress } from './Progress'
import { TrackInfo } from './TrackInfo'
import { Transport } from './Transport'
import { Volume } from './Volume'

export interface PlayerBarProps {
  track: Track | null
  playing: boolean
  loading: boolean
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  eqOpen: boolean
  desktopLyricsOpen: boolean
  queueLength: number
  onToggle(): void
  onNext(): void
  onPrev(): void
  onSeekRatio(ratio: number): void
  onVolume(volume: number): void
  onToggleMute(): void
  onToggleShuffle(): void
  onCycleRepeat(): void
  /** 点封面进「正在播放」；舞台是另一页，走它自己的键与按钮。 */
  onOpenNow(): void
  onOpenStage(): void
  onToggleEq(): void
  onOpenQueue(): void
  onToggleDesktopLyrics(): void
}

/**
 * 播放底栏：左边「在放什么」，中间「怎么放」，右边「界面怎么显示」。
 *
 * 三块的分工是先定的，组件只是照着切：
 *
 * - 左（TrackInfo）只读：封面、标题、艺人。点封面进沉浸模式。
 * - 中（Transport + Progress）只管播放：上一首 / 播放 / 下一首是主键，
 *   随机与循环分列两侧当模式键；下面一行是时间、进度、总时长。
 * - 右（视图键 + Volume）只管「看得见的东西」：桌面歌词、队列、均衡器、舞台，
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
  shuffle,
  repeat,
  eqOpen,
  desktopLyricsOpen,
  queueLength,
  onToggle,
  onNext,
  onPrev,
  onSeekRatio,
  onVolume,
  onToggleMute,
  onToggleShuffle,
  onCycleRepeat,
  onOpenNow,
  onOpenStage,
  onToggleEq,
  onOpenQueue,
  onToggleDesktopLyrics
}: PlayerBarProps) {
  return (
    <footer className="player">
      <TrackInfo track={track} onOpenNow={onOpenNow} />

      <div className="pb-core">
        <Transport
          playing={playing}
          loading={loading}
          disabled={!track}
          shuffle={shuffle}
          repeat={repeat}
          onToggle={onToggle}
          onNext={onNext}
          onPrev={onPrev}
          onToggleShuffle={onToggleShuffle}
          onCycleRepeat={onCycleRepeat}
        />
        <Progress duration={duration} disabled={!track} onSeekRatio={onSeekRatio} />
      </div>

      <div className="pb-side">
        <ControlButton
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
          badge={queueLength}
          onClick={onOpenQueue}
        >
          <Queue size={17} />
        </ControlButton>
        <ControlButton
          label="均衡器"
          tip="均衡器"
          hint="均衡器 (E)"
          active={eqOpen}
          pressed={eqOpen}
          onClick={onToggleEq}
        >
          <Sliders size={17} />
        </ControlButton>
        <ControlButton
          label="舞台"
          tip="舞台"
          hint="舞台 (L)"
          disabled={!track}
          onClick={onOpenStage}
        >
          <Expand size={17} />
        </ControlButton>

        <span className="pb-sep" aria-hidden="true" />

        <Volume volume={volume} muted={muted} onVolume={onVolume} onToggleMute={onToggleMute} />
      </div>
    </footer>
  )
}
