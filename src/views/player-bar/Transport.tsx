import type { RepeatMode } from '../../types'
import { Next, Pause, Play, Prev, Repeat, RepeatOne, Shuffle } from '../../ui/icons'
import { ControlButton } from './ControlButton'

/** 循环模式的中文名与提示，两行表比嵌套三元好读。 */
const REPEAT_TEXT: Record<RepeatMode, { label: string; tip: string }> = {
  off: { label: '循环：关闭', tip: '循环关闭' },
  all: { label: '循环：列表', tip: '列表循环' },
  one: { label: '循环：单曲', tip: '单曲循环' }
}

interface TransportProps {
  playing: boolean
  loading: boolean
  /** 没有在播放的曲目时，播放键不可用。 */
  disabled: boolean
  shuffle: boolean
  repeat: RepeatMode
  onToggle(): void
  onNext(): void
  onPrev(): void
  onToggleShuffle(): void
  onCycleRepeat(): void
}

/**
 * 传输区。
 *
 * 分三组而不是五颗平铺：中间一组是「动播放位置」的（上一首 / 播放 / 下一首），
 * 两侧是「改播放方式」的（随机、循环）。组与组之间留出的距离比组内大，眼睛
 * 一眼就能分出主次；之前的五颗等距，播放键只比旁边亮一点，层级是平的。
 */
export function Transport({
  playing,
  loading,
  disabled,
  shuffle,
  repeat,
  onToggle,
  onNext,
  onPrev,
  onToggleShuffle,
  onCycleRepeat
}: TransportProps) {
  const repeatText = REPEAT_TEXT[repeat]

  return (
    <div className="pb-transport" role="group" aria-label="播放控制">
      <ControlButton
        variant="mode"
        label="随机播放"
        tip="随机播放"
        active={shuffle}
        pressed={shuffle}
        onClick={onToggleShuffle}
      >
        <Shuffle size={17} />
      </ControlButton>

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

      <ControlButton
        variant="mode"
        label={repeatText.label}
        tip={repeatText.tip}
        active={repeat !== 'off'}
        pressed={repeat !== 'off'}
        onClick={onCycleRepeat}
      >
        {repeat === 'one' ? <RepeatOne size={17} /> : <Repeat size={17} />}
      </ControlButton>
    </div>
  )
}
