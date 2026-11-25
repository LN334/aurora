import { usePlayer } from '../../../features/player/store'
import { Note, Row, Rows, SettingsCard } from '../parts'

/**
 * 播放控制。
 *
 * 这一页只放「播放行为」本身。音源顺序与各平台音质在「音源与音质」，
 * 歌词来源在「歌词」——同一件事只在一个地方能改。
 */
export function PlaybackPane() {
  const crossfadeSec = usePlayer((state) => state.crossfadeSec)
  const setCrossfade = usePlayer((state) => state.setCrossfade)

  return (
    <>
      <SettingsCard
        title="切歌"
        hint="只影响本机播放；在线音源切歌时仍要先把这个流切断，交叉淡化只处理前后两首的重叠。"
      >
        <Rows>
          <Row
            label="交叉淡化"
            desc="上一首淡出、下一首淡入的重叠时长。0 秒表示硬切；听整张专辑时通常留 0 更干净。"
            id="playback-crossfade"
            stack
          >
            <div className="settings__slider">
              <input
                type="range"
                min={0}
                max={6}
                step={0.5}
                value={crossfadeSec}
                aria-label="交叉淡化时长"
                onChange={(event) => setCrossfade(Number(event.target.value))}
              />
              <span className="settings__number">{crossfadeSec} 秒</span>
            </div>
          </Row>
        </Rows>
      </SettingsCard>

      <Note>
        均衡器与声道在播放页的调音台里调——它们要边听边看频谱，不放在设置页。桌面歌词与播放页歌词的字号分别在「桌面歌词」「歌词」。
      </Note>
    </>
  )
}
