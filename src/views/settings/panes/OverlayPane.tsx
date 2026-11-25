import { useEffect, useState } from 'react'
import { bridge, isNative } from '../../../bridge'
import { useOverlayStatus } from '../../../features/overlay/status'
import type { OverlayAlign } from '../../../env'
import type { useSettingsPage } from '../../../features/settings/store'
import { Choice, Note, Row, Rows, SettingsCard, Toggle } from '../parts'

const ALIGNS: { id: OverlayAlign; name: string }[] = [
  { id: 'center', name: '居中' },
  { id: 'left', name: '左对齐' }
]

/**
 * 桌面歌词。
 *
 * 这是一个独立的置顶小窗，主进程持有它的开关、锁与字号；这里只把意愿写下去，
 * 再把主进程报回来的状态画出来，不在渲染层猜「现在应该是开的」。
 */
export function OverlayPane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const status = useOverlayStatus()
  const { desktopLyrics } = page.settings
  const open = status?.open ?? false
  const locked = status?.locked ?? false
  const [sizeDraft, setSizeDraft] = useState(desktopLyrics.size)

  /* 从托盘或快捷方式改了字号时，让草稿跟着真值走。 */
  useEffect(() => {
    setSizeDraft(desktopLyrics.size)
  }, [desktopLyrics.size])

  const commitSize = (): void => {
    if (sizeDraft !== desktopLyrics.size) void page.setLyricsSize(sizeDraft)
  }

  return (
    <>
      <SettingsCard
        title="显示与锁定"
        hint="桌面歌词是浮在所有窗口上面的一条，跟主窗口开不开没关系。"
      >
        <Rows>
          <Row
            label="显示桌面歌词"
            desc="和按快捷键是同一个开关。关掉只是收起窗口，不会停止播放。"
            id="overlay-open"
            aside={isNative ? (open ? '显示中' : '已收起') : '仅桌面版'}
          >
            <Toggle
              checked={open}
              label="显示桌面歌词"
              disabled={!isNative}
              onChange={() => void bridge.overlay.toggle(!open)}
            />
          </Row>
          <Row
            label="锁住歌词位置"
            desc="锁住后鼠标可以直接穿过歌词点到底下的窗口；要拖动得先解锁。"
            id="overlay-lock"
          >
            <Toggle
              checked={locked}
              label="锁住歌词位置"
              disabled={!isNative || !open}
              onChange={(next) => void bridge.overlay.setLocked(next)}
            />
          </Row>
          <Row
            label="锁住时也能悬停"
            desc="鼠标停在歌词上时临时接管，浮出上一首/播放/下一首那条工具条；移开就恢复穿透。"
            id="overlay-hover"
          >
            <Toggle
              checked={page.settings.overlayHoverControls}
              label="锁住时也能悬停"
              disabled={!isNative || page.busy}
              onChange={(next) => void page.setOverlayHoverControls(next)}
            />
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard
        title="字号与内容"
        hint="字号是这一扇小窗自己的，和播放页里那一列歌词分开调。"
      >
        <Rows>
          <Row label="字号" desc="超大字号适合副屏或离得远的时候；主窗口的播放页不受影响。" id="overlay-size" stack>
            <div className="settings__preview" style={{ fontSize: sizeDraft }}>
              我把名字写在起雾的玻璃上
            </div>
            <div className="settings__slider">
              <input
                type="range"
                min={desktopLyrics.min}
                max={desktopLyrics.max}
                step={1}
                value={sizeDraft}
                aria-label="桌面歌词字号"
                onChange={(event) => setSizeDraft(Number(event.target.value))}
                onPointerUp={commitSize}
                onKeyUp={commitSize}
              />
              <span className="settings__number">{sizeDraft}px</span>
            </div>
          </Row>
          <Row
            label="显示下一句"
            desc="在主行下面预告下一句，唱长段时不容易空等。"
            id="overlay-next"
          >
            <Toggle
              checked={page.settings.overlayNextLine}
              label="显示下一句"
              disabled={!isNative || page.busy}
              onChange={(next) => void page.setOverlayNextLine(next)}
            />
          </Row>
          <Row
            label="显示译文"
            desc="音源带翻译时，把译文排在主行下面；没有翻译就什么都不显示。"
            id="overlay-translation"
          >
            <Toggle
              checked={page.settings.overlayTranslation}
              label="显示译文"
              disabled={!isNative || page.busy}
              onChange={(next) => void page.setOverlayTranslation(next)}
            />
          </Row>
          <Row label="对齐" desc="左对齐适合贴屏幕边缘放；居中适合摆在屏幕中间。" id="overlay-align">
            <Choice
              value={page.settings.overlayAlign}
              options={ALIGNS}
              label="歌词对齐"
              disabled={!isNative || page.busy}
              onChange={(next) => void page.setOverlayAlign(next)}
            />
          </Row>
        </Rows>
      </SettingsCard>

      {isNative ? null : <Note tone="warn">桌面歌词只在桌面版里可用，网页预览里这几项不会生效。</Note>}
    </>
  )
}
