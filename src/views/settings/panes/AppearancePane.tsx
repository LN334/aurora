import { useEffect, useState } from 'react'
import { useSettingsPage } from '../../../features/settings/store'
import { useWallpaper } from '../../../features/wallpaper/store'
import { Refresh } from '../../../ui/icons'
import { Row, Rows, Toggle } from '../parts'
import { WallpaperGrid } from '../WallpaperGrid'

/**
 * 03 外观与桌面。
 *
 * 两件事都属于「界面之外的那块屏幕」：桌面歌词是独立窗口，动态背景是窗口底下的那层。
 * Wallpaper Engine 的开关、壁纸库与可见度沿用原有 store 与 WallpaperGrid，逻辑一行没改，
 * 只是从原来的「外观」分组搬进了这个编号分区。
 */
export function AppearancePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const wallpaperEnabled = useWallpaper((state) => state.enabled)
  const setWallpaperEnabled = useWallpaper((state) => state.setEnabled)
  const wallpaperSelection = useWallpaper((state) => state.selection)
  const setWallpaperSelection = useWallpaper((state) => state.setSelection)
  const wallpaperStrength = useWallpaper((state) => state.strength)
  const setWallpaperStrength = useWallpaper((state) => state.setStrength)
  const wallpaperInfo = useWallpaper((state) => state.info)
  const wallpaperList = useWallpaper((state) => state.list)
  const wallpaperLoading = useWallpaper((state) => state.loading)
  const refreshWallpaper = useWallpaper((state) => state.refresh)
  const { desktopLyrics } = page.settings

  // 滑杆拖动时只改本地值，松手/松开按键才落盘：一次拖动只写一次设置。
  const [previewSize, setPreviewSize] = useState(desktopLyrics.size)
  useEffect(() => {
    setPreviewSize(desktopLyrics.size)
  }, [desktopLyrics.size])

  useEffect(() => {
    if (wallpaperEnabled) void refreshWallpaper()
  }, [wallpaperEnabled, refreshWallpaper])

  const wallpaperHint =
    wallpaperInfo && !wallpaperInfo.found
      ? wallpaperInfo.note
      : '把 Wallpaper Engine 的壁纸当作播放器的背景。场景壁纸（.pkg）由内置的 WebGL 场景引擎渲染，和 Wallpaper Engine 里看到的是同一份工程；视频与网页壁纸直接播放。'

  const wallpaperLibraryHint =
    wallpaperList.length === 0
      ? wallpaperLoading
        ? '正在扫描 Wallpaper Engine 壁纸库…'
        : '没有读到壁纸：可能没有安装 Wallpaper Engine，或创意工坊目录是空的。'
      : `${wallpaperList.length} 张可用，滚轮翻看，点一下就是背景。场景壁纸由内置的 WebGL 场景引擎渲染；网页与视频壁纸直接播放。`

  return (
    <Rows>
      <div className="settings__row settings__row--stacked">
        <div className="settings__text">
          <div className="settings__label">桌面歌词字号</div>
          <p className="settings__hint">
            桌面歌词窗口是独立窗口，这里改的是它的字号；歌词窗口自己也能调，两边始终一致。
          </p>
        </div>
        <div className="settings__preview" style={{ fontSize: previewSize }}>
          我把名字写在起雾的玻璃上
        </div>
        <div className="settings__slider">
          <input
            type="range"
            min={desktopLyrics.min}
            max={desktopLyrics.max}
            step={1}
            value={previewSize}
            aria-label="桌面歌词字号"
            onChange={(event) => setPreviewSize(Number(event.target.value))}
            onPointerUp={() => void page.setLyricsSize(previewSize)}
            onKeyUp={() => void page.setLyricsSize(previewSize)}
          />
          <span className="settings__number">{previewSize}px</span>
        </div>
      </div>

      <Row label="Wallpaper Engine 动态背景" hint={wallpaperHint}>
        <Toggle
          checked={wallpaperEnabled}
          label="Wallpaper Engine 动态背景"
          onChange={(next) => setWallpaperEnabled(next)}
        />
      </Row>

      {wallpaperEnabled ? (
        <>
          <div className="settings__row settings__row--stacked">
            <div className="wp-picker">
              <div className="wp-picker__head">
                <div className="settings__text">
                  <div className="settings__label">壁纸库</div>
                  <p className="settings__hint">{wallpaperLibraryHint}</p>
                </div>
                <button
                  className="btn"
                  onClick={() => void refreshWallpaper(true)}
                  disabled={wallpaperLoading}
                >
                  <Refresh size={14} />
                  {wallpaperLoading ? '读取中…' : '重新读取'}
                </button>
              </div>
              <WallpaperGrid
                list={wallpaperList}
                selection={wallpaperSelection}
                onSelect={setWallpaperSelection}
              />
            </div>
          </div>

          <div className="settings__row settings__row--stacked">
            <div className="settings__text">
              <div className="settings__label">壁纸可见度</div>
              <p className="settings__hint">
                往右壁纸更清楚，往左界面文字更清楚。壁纸看不清时先调这里。
              </p>
            </div>
            <div className="settings__slider">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(wallpaperStrength * 100)}
                aria-label="壁纸可见度"
                onChange={(event) => setWallpaperStrength(Number(event.target.value) / 100)}
              />
              <span className="settings__number">{Math.round(wallpaperStrength * 100)}%</span>
            </div>
          </div>
        </>
      ) : null}
    </Rows>
  )
}
