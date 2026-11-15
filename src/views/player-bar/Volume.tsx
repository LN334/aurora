import { Bar } from '../../features/player/Bar'
import { wheelVolume } from '../../features/player/volume'
import { Volume as VolumeIcon, VolumeMute } from '../../ui/icons'
import { ControlButton } from './ControlButton'

/**
 * 音量：一颗静音键 + 一条滑条。
 *
 * 滑条在窄窗口里会被 CSS 收起来，但静音键不收：滚轮挂在滑条上，滑条没了就
 * 用键盘的 ↑↓（全局快捷键），所以窄窗口里仍然调得了音量，只是少一条长条。
 */
export function Volume({
  volume,
  muted,
  onVolume,
  onToggleMute
}: {
  volume: number
  muted: boolean
  onVolume(volume: number): void
  onToggleMute(): void
}) {
  const effective = muted ? 0 : volume
  const text = muted ? '已静音' : `音量 ${Math.round(effective * 100)}%`

  return (
    <div className="pb-vol">
      <ControlButton
        label={muted ? '取消静音' : '静音'}
        tip={text}
        onClick={onToggleMute}
        /*
         * 滚轮在静音键上也调音量。
         *
         * 只挂在滑条上时，鼠标得先精确落到那条 84px 的线上才滚得动；人从
         * 静音键上滚一下没反应，会以为滚轮坏了。
         */
        onWheel={(event) => onVolume(wheelVolume(effective, event.deltaY > 0 ? -1 : 1))}
      >
        {effective === 0 ? <VolumeMute size={18} /> : <VolumeIcon size={18} />}
      </ControlButton>
      <Bar
        className="pb-volume"
        value={effective}
        onChange={onVolume}
        ariaLabel="音量"
        valueText={text}
        onWheelDelta={(direction) => onVolume(wheelVolume(effective, direction))}
      />
    </div>
  )
}
