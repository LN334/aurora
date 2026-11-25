import { useEffect, useState } from 'react'
import { LYRICS_MAX_SIZE, LYRICS_MIN_SIZE, useLyricSize, writeLyricSize } from '../../../features/settings/lyric-size'
import type { useSettingsPage } from '../../../features/settings/store'
import { Note, Row, Rows, SettingsCard, Toggle } from '../parts'

/**
 * 歌词来源与播放页字号。
 *
 * 字号改的是播放页右侧那一列（以及全屏歌词），和桌面歌词那个独立窗口无关，
 * 所以两处分开放。在线歌词是主进程的设置：它决定要不要向平台查词。
 */
export function LyricsPane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const current = useLyricSize()
  const [draft, setDraft] = useState<number | null>(null)
  const size = draft ?? current

  /* 别处改了字号时把草稿让回真值，免得滑块停在旧位置。 */
  useEffect(() => {
    setDraft(null)
  }, [current])

  const commit = (): void => {
    writeLyricSize(size)
    setDraft(null)
  }

  return (
    <>
      <SettingsCard title="来源" hint="歌词优先用平台自己给的那份，没有才去查。">
        <Rows>
          <Row
            label="在线歌词"
            desc="向在线平台查询歌词与逐字时间轴；关掉只显示本地已缓存或文件内嵌的歌词。"
            id="lyrics-online"
          >
            <Toggle
              checked={page.settings.onlineLyrics}
              label="在线歌词查询"
              disabled={page.busy}
              onChange={(next) => void page.setOnlineLyrics(next)}
            />
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard title="播放页" hint="这一项只影响主窗口里的歌词，桌面歌词另有自己的字号。">
        <Rows>
          <Row
            label="歌词字号"
            desc="全屏播放页与右侧歌词列同步变化；行高会跟着字号等比例放大，不会挤在一起。"
            id="lyrics-size"
            stack
          >
            <div className="settings__slider">
              <input
                type="range"
                min={LYRICS_MIN_SIZE}
                max={LYRICS_MAX_SIZE}
                step={1}
                value={size}
                aria-label="播放页歌词字号"
                onChange={(event) => setDraft(Number(event.target.value))}
                onPointerUp={commit}
                onKeyUp={commit}
              />
              <span className="settings__number">{size}px</span>
            </div>
          </Row>
        </Rows>
      </SettingsCard>

      <Note>逐字高亮与翻译取决于音源有没有提供；没有时间轴时整行会作为一个整体显示。</Note>
    </>
  )
}
