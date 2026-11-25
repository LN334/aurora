import { useEffect, useState } from 'react'
import { bridge, isNative } from '../../../bridge'
import { setAccentFromArt, useAccentFromArt } from '../../../features/settings/accent'
import { applyBackdrop, BLUR_MAX, BLUR_MIN, useBackdrop, writeBackdrop } from '../../../features/settings/backdrop'
import { THEMES, useTheme, writeTheme } from '../../../features/settings/theme'
import { useWallpaper } from '../../../features/wallpaper/store'
import { chooseEntry } from '../../../features/wallpaper/pure'
import { Refresh } from '../../../ui/icons'
import { Choice, Note, Row, Rows, SettingsCard, Toggle } from '../parts'
import { WallpaperGrid } from '../WallpaperGrid'
import { WallpaperProps } from '../WallpaperProps'

const BACKDROPS = [
  { id: 'frosted', name: '标准亚克力' },
  { id: 'clear', name: '轻薄亚克力' }
]

/**
 * 外观：主题、背景玻璃、图标、动态壁纸。
 *
 * 只放「整块界面长什么样」的东西。首页分区与行密度搬到「首页与媒体库」，动效搬到
 * 「动效」，歌词字号搬到「歌词」与「桌面歌词」——同一件事只留一个入口，省得用户
 * 在两页里看到同一个开关却不知道哪个算数。
 */
export function AppearancePane() {
  const theme = useTheme()
  const backdrop = useBackdrop()
  const accentFromArt = useAccentFromArt()
  const [blurDraft, setBlurDraft] = useState<number | null>(null)
  const backdropBlur = blurDraft ?? backdrop.blur

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
  /* 桌面此刻那张：「跟随当前壁纸」那格画的是「跟随会跟到哪一张」。 */
  const followedWallpaper = wallpaperList.find((entry) => entry.current) ?? null

  const [appIcon, setAppIcon] = useState<{ custom: boolean; dataUrl: string }>({
    custom: false,
    dataUrl: ''
  })
  const [iconBusy, setIconBusy] = useState(false)
  const [iconNotice, setIconNotice] = useState('')

  useEffect(() => {
    void bridge.app.getIcon().then(setAppIcon)
  }, [])

  useEffect(() => {
    if (wallpaperEnabled) void refreshWallpaper()
  }, [wallpaperEnabled, refreshWallpaper])

  async function chooseAppIcon(): Promise<void> {
    setIconBusy(true)
    setIconNotice('')
    const result = await bridge.app.chooseIcon()
    setIconBusy(false)
    if (!result.ok) {
      // 用户自己点取消不算错，安静回去就行。
      if (!result.canceled) setIconNotice(result.reason ?? '这张图没用上，再试一张')
      return
    }
    setAppIcon(await bridge.app.getIcon())
  }

  async function resetAppIcon(): Promise<void> {
    setIconBusy(true)
    await bridge.app.resetIcon()
    setAppIcon(await bridge.app.getIcon())
    setIconBusy(false)
    setIconNotice('')
  }

  return (
    <>
      <SettingsCard
        title="主题与背景"
        hint="颜色全在主题里分两套写死，换主题不会改变布局；背景处理只决定壁纸被玻璃盖住多少。"
      >
        <Rows>
          <Row
            label="主题"
            desc="跟随系统会随 Windows 的明暗切换；选深色/浅色则一直保持。"
            id="appearance-theme"
          >
            <Choice
              value={theme.id}
              options={THEMES}
              label="主题"
              onChange={(next) => writeTheme(next)}
            />
          </Row>
          <Row
            label="背景"
            desc="标准亚克力把壁纸糊成一片颜色，字最稳；轻薄亚克力图看得清，适合安静壁纸。"
            id="appearance-backdrop"
          >
            <Choice
              value={backdrop.mode}
              options={BACKDROPS}
              label="背景处理"
              onChange={(next) => writeBackdrop({ ...backdrop, mode: next as 'frosted' | 'clear' })}
            />
          </Row>
          <Row
            label="模糊程度"
            desc="拖动时界面当场变，松手才保存；0 表示只铺一层淡底、完全不糊。"
            id="appearance-blur"
            stack
          >
            <div className="settings__slider">
              <input
                type="range"
                min={BLUR_MIN}
                max={BLUR_MAX}
                step={1}
                value={backdropBlur}
                aria-label="背景模糊程度"
                onChange={(event) => {
                  const next = Number(event.target.value)
                  setBlurDraft(next)
                  applyBackdrop({ ...backdrop, blur: next })
                }}
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
          <Row
            label="界面跟着封面取色"
            desc="关掉后强调色退回固定的冷灰。动态壁纸本身颜色很热闹时，关掉能少一层冲突。"
            id="appearance-accent"
          >
            <Toggle
              checked={accentFromArt}
              label="界面跟着封面取色"
              onChange={(next) => setAccentFromArt(next)}
            />
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard title="应用图标" hint="只换这台机器上的图标，不改安装包；任务栏与开始菜单会一起变。">
        <Rows>
          <Row
            label="图标"
            desc="选一张方形图片，应用会缩成系统要的几档尺寸。取消不算失败。"
            id="appearance-icon"
          >
            <div className="set-icon">
              {appIcon.dataUrl ? (
                <img className="set-icon__prev" src={appIcon.dataUrl} alt="" />
              ) : (
                <span className="set-icon__prev" />
              )}
              <button
                className="btn"
                type="button"
                disabled={!isNative || iconBusy}
                onClick={() => void chooseAppIcon()}
              >
                {iconBusy ? '读取中…' : appIcon.custom ? '换一张' : '换个图标'}
              </button>
              {appIcon.custom ? (
                <button
                  className="btn btn--ghost"
                  type="button"
                  disabled={iconBusy}
                  onClick={() => void resetAppIcon()}
                >
                  恢复默认
                </button>
              ) : null}
              {iconNotice ? <p className="set-icon__notice">{iconNotice}</p> : null}
            </div>
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard
        title="动态背景"
        hint="接 Wallpaper Engine 的壁纸，窗口后面的桌面层会跟着动；关掉就用静态背景。"
      >
        <Rows>
          <Row
            label="启用动态背景"
            desc="读取本机 Wallpaper Engine 已安装的壁纸；首次开启会扫一遍壁纸库，需要几秒。"
            id="appearance-wallpaper"
          >
            <Toggle
              checked={wallpaperEnabled}
              label="Wallpaper Engine 动态背景"
              onChange={(next) => setWallpaperEnabled(next)}
            />
          </Row>
        </Rows>

        {wallpaperEnabled ? (
          <>
            <div className="settings__row settings__row--stacked">
              <div className="wp-picker">
                <div className="wp-picker__head">
                  <div className="settings__text">
                    <div className="settings__label">壁纸库</div>
                    <p className="settings__desc">
                      首格「跟随当前壁纸」跟着 Wallpaper Engine 里正在用的那张走。
                    </p>
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
                  followPreview={followedWallpaper?.previewUrl ?? null}
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
            {wallpaperEntry && wallpaperEntry.kind === 'scene' && wallpaperEntry.hasPackage ? (
              <div className="settings__row settings__row--stacked">
                <div className="settings__text">
                  <div className="settings__label">壁纸画质</div>
                  <p className="settings__desc">
                    省电降帧率与分辨率，笔记本电池下更耐用；清晰优先画面质量。
                  </p>
                </div>
                <Choice
                  value={wallpaperQuality}
                  options={[
                    { id: 'saver', name: '省电' },
                    { id: 'balanced', name: '均衡' },
                    { id: 'sharp', name: '清晰' }
                  ]}
                  label="壁纸画质"
                  onChange={(next) => setWallpaperQuality(next)}
                />
              </div>
            ) : null}

            <div className="settings__row settings__row--stacked">
              <div className="settings__text">
                <div className="settings__label">壁纸可见度</div>
                <p className="settings__desc">
                  壁纸在玻璃后面的透明度。调高看得更清楚，文字对比度会下降。
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
      </SettingsCard>

      <Note>列表行密度、首页分区在「首页与媒体库」；舞台粒子与减少动效在「动效」；歌词字号在「歌词」。</Note>
    </>
  )
}
