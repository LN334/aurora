import { Bar, useProgressPosition } from '../../features/player/Bar'
import { formatTime } from '../../ui/format'

/**
 * 进度行单独成一个组件，是因为它自己订阅播放头。
 *
 * 订阅留在这一层，整棵树就不跟着播放头重渲染：底栏其余部分每次换歌才动一次，
 * 进度条与时间按八分之一秒更新（见 useProgressPosition 的注释）。把订阅提到
 * PlayerBar 会让「播放中」这个状态穿透到曲目信息与右侧所有按钮。
 */
export function Progress({
  duration,
  disabled,
  onSeekRatio
}: {
  duration: number
  disabled: boolean
  onSeekRatio(ratio: number): void
}) {
  const position = useProgressPosition()
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0

  return (
    <div className="pb-rail">
      <span className="pb-time">{formatTime(position)}</span>
      <Bar
        value={ratio}
        onChange={onSeekRatio}
        disabled={disabled || duration <= 0}
        ariaLabel="播放进度"
        valueText={`${formatTime(position)} / ${formatTime(duration)}`}
      />
      <span className="pb-time pb-time--end">{formatTime(duration)}</span>
    </div>
  )
}
