import type { PlayMode } from '../../features/player/mode'
import { MODE_TEXT } from '../../features/player/mode'
import { Next, Order, Pause, Play, Prev, Repeat, RepeatOne, Shuffle } from '../../ui/icons'
import { ControlButton } from './ControlButton'

/** 四态各自的图标：顺序不闭环，列表与单曲闭环，随机是两支交叉箭头。 */
function ModeIcon({ mode }: { mode: PlayMode }) {
  if (mode === 'shuffle') return <Shuffle size={17} />
  if (mode === 'one') return <RepeatOne size={17} />
  if (mode === 'loop') return <Repeat size={17} />
  return <Order size={17} />
}

interface TransportProps {
  playing: boolean
  loading: boolean
  /** 没有在播放的曲目时，播放键不可用。 */
  disabled: boolean
  /** 顺序 / 列表循环 / 单曲循环 / 随机，四态一颗键。 */
  mode: PlayMode
  onToggle(): void
  onNext(): void
  onPrev(): void
  onCycleMode(): void
  /**
   * 漫游时不显示模式键。
   *
   * 它改的是「这一队列怎么放」，而漫游的一趟本来就从池子里随机挑、走到头
   * 还会自己续，再挂一个模式键只是把同一件事说第二遍。普通队列里它照旧——
   * 那里才有「顺序重排」与「到底停不停」可谈。
   */
  hideModes?: boolean
}

/**
 * 传输区。
 *
 * 两组而不是四颗平铺：左边一颗改「怎么放」，右边一组「动播放位置」。
 * 原来的随机与循环分列播放键两侧，读起来像两个互不相干的开关；其实它们是
 * 同一件事的四个状态，合成一颗键后点一次就能走完全程，也不用记哪颗管哪颗。
 */
export function Transport({
  playing,
  loading,
  disabled,
  mode,
  onToggle,
  onNext,
  onPrev,
  onCycleMode,
  hideModes
}: TransportProps) {
  const text = MODE_TEXT[mode]

  return (
    <div className="pb-transport" role="group" aria-label="播放控制">
      {hideModes ? null : (
        <ControlButton
          variant="mode"
          label={text.label}
          tip={text.tip}
          hint={text.hint}
          active={mode !== 'order'}
          pressed={mode !== 'order'}
          onClick={onCycleMode}
        >
          <ModeIcon mode={mode} />
        </ControlButton>
      )}

      <div className="pb-transport__main">
        <ControlButton label="上一首" onClick={onPrev} className="pb-btn--skip">
          <Prev size={19} />
        </ControlButton>

        <button
          type="button"
          className="pb-play"
          onClick={onToggle}
          disabled={disabled}
          title={playing ? '暂停' : '播放'}
          aria-label={playing ? '暂停' : '播放'}
        >
          {loading && !playing ? (
            <span className="pb-play__spinner" />
          ) : playing ? (
            <Pause size={20} />
          ) : (
            <Play size={20} />
          )}
        </button>

        <ControlButton label="下一首" onClick={onNext} className="pb-btn--skip">
          <Next size={19} />
        </ControlButton>
      </div>
    </div>
  )
}
