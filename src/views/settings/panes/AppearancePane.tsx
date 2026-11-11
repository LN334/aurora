import { useEffect, useState } from 'react'
import { setAccentFromArt, useAccentFromArt } from '../../../features/settings/accent'
import { readReduceMotion, writeReduceMotion } from '../../../features/settings/motion'
import { ROW_DENSITIES, useRowDensity, writeRowDensity } from '../../../features/settings/row-density'
import { THEMES, useTheme, writeTheme } from '../../../features/settings/theme'
import { BLUR_MAX, BLUR_MIN, useBackdrop, writeBackdrop } from '../../../features/settings/backdrop'
import { LYRICS_MAX_SIZE, LYRICS_MIN_SIZE, useLyricSize, writeLyricSize } from '../../../features/settings/lyric-size'
import { useSettingsPage } from '../../../features/settings/store'
import { bridge, isNative } from '../../../bridge'
import { useOverlayStatus } from '../../../features/overlay/status'
import { useWallpaper } from '../../../features/wallpaper/store'
import { chooseEntry } from '../../../features/wallpaper/pure'
import { Refresh } from '../../../ui/icons'
import { Row, Rows, Sub, Toggle } from '../parts'
import { WallpaperGrid } from '../WallpaperGrid'
import { WallpaperProps } from '../WallpaperProps'

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
  const wallpaperQuality = useWallpaper((state) => state.quality)
  const setWallpaperQuality = useWallpaper((state) => state.setQuality)
  const wallpaperInfo = useWallpaper((state) => state.info)
  const wallpaperList = useWallpaper((state) => state.list)
  const wallpaperLoading = useWallpaper((state) => state.loading)
  const refreshWallpaper = useWallpaper((state) => state.refresh)
  const setWallpaperProperty = useWallpaper((state) => state.setProperty)
  const resetWallpaperProperties = useWallpaper((state) => state.resetProperties)
  const backdrop = useBackdrop()
  const [blurDraft, setBlurDraft] = useState<number | null>(null)
  const backdropBlur = blurDraft ?? backdrop.blur
  const { desktopLyrics } = page.settings

  /*
   * 正在当背景的那一张。可调项跟着它走——切到「跟随当前壁纸」时，
   * 调的就是 WE 现在用的那张。
   */
  const wallpaperEntry = chooseEntry({
    enabled: wallpaperEnabled,
    selection: wallpaperSelection,
    info: wallpaperInfo,
    list: wallpaperList
  })
  const wallpaperValues = useWallpaper((state) =>
    wallpaperEntry ? state.values[wallpaperEntry.id] : undefined
  )

  // 动态效果是纯渲染层的偏好，存 localStorage：改完立刻生效，不必进主进程设置。
  const [reduceMotion, setReduceMotion] = useState(readReduceMotion)
  const accentFromArt = useAccentFromArt()
  const density = useRowDensity()
  const theme = useTheme()

  // 滑杆拖动时只改本地值，松手/松开按键才落盘：一次拖动只写一次设置。
  const [previewSize, setPreviewSize] = useState(desktopLyrics.size)
  const lyricSizeNow = useLyricSize()
  const [lyricDraft, setLyricDraft] = useState<number | null>(null)
  const lyricSize = lyricDraft ?? lyricSizeNow
  useEffect(() => {
    setPreviewSize(desktopLyrics.size)
  }, [desktopLyrics.size])

  /* 别处（或另一个窗口）改了字号时，把草稿让回真值 */
  useEffect(() => {
    setLyricDraft(null)
  }, [lyricSizeNow])

  useEffect(() => {
    if (wallpaperEnabled) void refreshWallpaper()
  }, [wallpaperEnabled, refreshWallpaper])

  const wallpaperHint =
    wallpaperInfo && !wallpaperInfo.found
      ? wallpaperInfo.note
      : '把 Wallpaper Engine 的壁纸当作播放器背景，场景、视频、网页壁纸都能放。'

  const wallpaperLibraryHint =
    wallpaperList.length === 0
      ? wallpaperLoading
        ? '正在扫描 Wallpaper Engine 壁纸库…'
        : '没有读到壁纸：可能没有安装 Wallpaper Engine，或创意工坊目录是空的。'
      : `${wallpaperList.length} 张可用，点一下就是背景。`

  return (
    <Rows>
      <Row
        label="主题"
        hint="跟随系统会随 Windows 的明暗设置切换；手动选了就一直用那一套。"
      >
        <div className="seg">
          {THEMES.map((item) => (
            <button
              key={item.id}
              className={theme.id === item.id ? 'is-active' : ''}
              onClick={() => writeTheme(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </Row>

      <Row label="背景" hint="磨砂会给壁纸垫一层雾，字更清楚；透出则壁纸原样铺满。">
        <div className="seg">
          <button
            className={backdrop.mode === 'frosted' ? 'is-active' : ''}
            onClick={() => writeBackdrop({ ...backdrop, mode: 'frosted' })}
          >
            磨砂
          </button>
          <button
            className={backdrop.mode === 'clear' ? 'is-active' : ''}
            onClick={() => writeBackdrop({ ...backdrop, mode: 'clear' })}
          >
            透出
          </button>
        </div>
      </Row>

      {backdrop.mode === 'frosted' ? (
        <Row label="磨砂程度" hint="0 只铺一层淡底不糊，越大壁纸越模糊。松手就生效。">
          <div className="settings__slider">
            <input
              type="range"
              min={BLUR_MIN}
              max={BLUR_MAX}
              step={1}
              value={backdropBlur}
              aria-label="磨砂程度"
              onChange={(event) => setBlurDraft(Number(event.target.value))}
              onPointerUp={() => {
                writeBackdrop({ ...backdrop, blur: backdropBlur })
                setBlurDraft(null)
              }}
              onKeyUp={() => {
                writeBackdrop({ ...backdrop, blur: backdropBlur })
                setBlurDraft(null)
              }}
            />
            <span className="settings__number">{backdropBlur}px</span>
          </div>
        </Row>
      ) : null}

      <Row
        label="界面跟着封面取色"
        hint="关掉后界面只用一套冷灰。开了壁纸、背景本身很花时，关掉更清爽。"
      >
        <Toggle
          checked={accentFromArt}
          label="界面跟着封面取色"
          onChange={(next) => setAccentFromArt(next)}
        />
      </Row>

      <Sub title="桌面歌词" hint="独立窗口，跟着当前播放的那一句走。">
        <DesktopLyricsRows page={page} />

      <div className="settings__row settings__row--stacked">
        <div className="settings__text">
          <div className="settings__label">桌面歌词字号</div>
          <p className="settings__hint">
            桌面歌词窗口的字号。
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

      <div className="settings__row settings__row--stacked">
        <div className="settings__text">
          <div className="settings__label">播放页歌词字号</div>
          <p className="settings__hint">播放页那一列歌词的大小，松手就生效。</p>
        </div>
        <div className="settings__slider">
          <input
            type="range"
            min={LYRICS_MIN_SIZE}
            max={LYRICS_MAX_SIZE}
            step={1}
            value={lyricSize}
            aria-label="播放页歌词字号"
            onChange={(event) => setLyricDraft(Number(event.target.value))}
            onPointerUp={() => {
              writeLyricSize(lyricSize)
              setLyricDraft(null)
            }}
            onKeyUp={() => {
              writeLyricSize(lyricSize)
              setLyricDraft(null)
            }}
          />
          <span className="settings__number">{lyricSize}px</span>
        </div>
      </div>
      </Sub>

      <Row
        label="窗口显示"
        hint="全屏不会记住，下次启动仍是普通窗口。"
      >
        <button className="btn" onClick={() => void bridge.window.toggleFullscreen()}>
          切换全屏 / F11
        </button>
      </Row>

      <Row
        label="动态效果"
        hint="关掉后界面动画直接跳过。"
      >
        <Toggle
          checked={reduceMotion}
          label="动态效果"
          onChange={(next) => {
            setReduceMotion(next)
            writeReduceMotion(next)
          }}
        />
      </Row>

      <Row label="列表行密度" hint="歌单、搜索结果、队列里每一行的高度。">
        <div className="seg">
          {ROW_DENSITIES.map((item) => (
            <button
              key={item.id}
              className={density.id === item.id ? 'is-active' : ''}
              onClick={() => writeRowDensity(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      </Row>

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

          {/*
            只有场景壁纸能吃到这些值：视频/网页/图片壁纸是原样播放的文件，
            没有可以注入属性的渲染器，显示出来只会点了没反应。
          */}
          {wallpaperEntry &&
          wallpaperEntry.kind === 'scene' &&
          wallpaperEntry.hasPackage &&
          (wallpaperEntry.properties?.length ?? 0) > 0 ? (
            <div className="settings__row settings__row--stacked">
              <WallpaperProps
                entry={wallpaperEntry}
                values={wallpaperValues}
                onChange={(name, value) => setWallpaperProperty(wallpaperEntry.id, name, value)}
                onReset={() => resetWallpaperProperties(wallpaperEntry.id)}
              />
            </div>
          ) : null}

          {/*
            只有场景壁纸有帧率与光栅化分辨率可调；视频/网页/图片是原样播放的
            文件，所以这一行只在选中场景时出现，不给用户一个点了没反应的分区。
          */}
          {wallpaperEntry &&
          wallpaperEntry.kind === 'scene' &&
          wallpaperEntry.hasPackage ? (
            <div className="settings__row settings__row--stacked">
              <div className="settings__text">
                <div className="settings__label">壁纸画质</div>
                <p className="settings__hint">
                  越高越清晰，也越费显卡和电。
                </p>
              </div>
              <div className="seg">
                {(
                  [
                    ['saver', '省电'],
                    ['balanced', '均衡'],
                    ['sharp', '清晰']
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={wallpaperQuality === value ? 'is-active' : ''}
                    aria-pressed={wallpaperQuality === value}
                    onClick={() => setWallpaperQuality(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="settings__row settings__row--stacked">
            <div className="settings__text">
              <div className="settings__label">壁纸可见度</div>
              <p className="settings__hint">
                往右壁纸更清楚，往左文字更清楚。
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

/**
 * 桌面歌词窗口的两行开关。
 *
 * 状态由主进程回报：窗口可能在别的入口被打开或关掉，这里只负责把当前状态
 * 画出来，不做本地猜测。锁上之后那个窗口对鼠标透明，和 Windows 上的悬浮控件
 * 一样，所以它只在歌词窗口开着的时候才有意义。
 */
function DesktopLyricsRows({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const status = useOverlayStatus()

  const open = status?.open ?? false
  const locked = status?.locked ?? false

  return (
    <>
      <Row
        label="显示桌面歌词"
        hint="在桌面上开一个小窗口，只显示当前这一句；换歌自动跟上。"
      >
        {isNative ? (
          <button className="btn" onClick={() => void bridge.overlay.toggle(!open)}>
            {open ? '关闭' : '打开'}
          </button>
        ) : (
          <span className="settings__number">仅桌面版</span>
        )}
      </Row>

      <Row
        label="锁住歌词位置"
        hint="锁上后鼠标点不中那一行字，点击会落到它底下的窗口上。"
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
        hint="开着：鼠标移到那行字上会浮出控制条，代价是那一下点击归歌词窗口。关掉：彻底穿透，要动它先解锁。"
      >
        <Toggle
          checked={page.settings.overlayHoverControls}
          label="锁住时也能悬停"
          disabled={page.busy}
          onChange={(next) => void page.setOverlayHoverControls(next)}
        />
      </Row>
    </>
  )
}
