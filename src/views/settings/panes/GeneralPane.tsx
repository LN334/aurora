import { useEffect, useState } from 'react'
import { bridge } from '../../../bridge'
import { readStartupPage, STARTUP_PAGES, writeStartupPage } from '../../../features/settings/startup-page'
import type { StartupPage } from '../../../features/settings/startup-page'
import { useSessionRestore, writeSessionRestore } from '../../../features/settings/session-restore'
import type { useSettingsPage } from '../../../features/settings/store'
import type { TrayClick } from '../../../env'
import { Choice, Note, Row, Rows, SettingsCard, Toggle } from '../parts'

const CLOSE_OPTIONS = [
  { id: 'tray', name: '收进托盘' },
  { id: 'quit', name: '退出应用' }
]

const TRAY_OPTIONS: { id: TrayClick; name: string }[] = [
  { id: 'toggle', name: '显示 / 隐藏' },
  { id: 'show', name: '只显示' }
]

/**
 * 通用：启动、关窗、托盘、缩放。
 *
 * 这一页是「程序本身怎么运行」，不含播放与外观。启动页面存 localStorage（只决定
 * 渲染层的第一个路由），关窗与托盘由主进程兑现，缩放要主进程写 webContents。
 */
export function GeneralPane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const { settings } = page
  const [startup, setStartup] = useState<StartupPage>(readStartupPage)
  const [zoomDraft, setZoomDraft] = useState<number | null>(null)
  const zoomPercent = zoomDraft ?? Math.round(settings.zoomFactor * 100)
  const restoreQueue = useSessionRestore()

  /* 主进程改了缩放（比如恢复默认）后，让草稿让回真值。 */
  useEffect(() => {
    setZoomDraft(null)
  }, [settings.zoomFactor])

  const commitZoom = (): void => {
    if (zoomPercent !== Math.round(settings.zoomFactor * 100)) {
      void page.setZoomFactor(zoomPercent / 100)
    }
  }

  return (
    <>
      <SettingsCard title="启动" hint="开机自启要打包后的版本才会真去系统里登记；开发时的开关只记住意愿。">
        <Rows>
          <Row
            label="启动时打开"
            desc="「上次那页」只记首页、歌单这类稳定页面，不还原到某张专辑。"
            id="general-startup"
          >
            <select
              className="settings__input"
              value={startup}
              aria-label="启动时打开"
              onChange={(event) => {
                const next = event.target.value as StartupPage
                setStartup(next)
                writeStartupPage(next)
              }}
            >
              {STARTUP_PAGES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="开机自启" desc="随 Windows 登录启动，启动后收在托盘里，不抢前台。" id="general-login">
            <Toggle
              checked={settings.launchAtLogin}
              label="开机自启"
              disabled={page.busy}
              onChange={(next) => void page.setLaunchAtLogin(next)}
            />
          </Row>
          <Row
            label="启动时恢复上次队列"
            desc="重开就接着上次那批歌，停在 0:00 等按播放；不恢复播放进度，避免撞上取不到流的歌。"
            id="general-restore"
          >
            <Toggle
              checked={restoreQueue}
              label="启动时恢复上次队列"
              onChange={(next) => writeSessionRestore(next)}
            />
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard title="窗口与托盘" hint="这些操作都在主进程里兑现；关窗与最小化的区别是「任务栏里还留不留图标」。">
        <Rows>
          <Row
            label="点关闭按钮时"
            desc="收进托盘不会停止播放；退出应用会结束播放并释放音频设备。"
            id="general-close"
          >
            <Choice
              value={settings.closeToTray ? 'tray' : 'quit'}
              options={CLOSE_OPTIONS}
              label="点关闭按钮时"
              disabled={page.busy}
              onChange={(next) => void page.setCloseToTray(next === 'tray')}
            />
          </Row>
          <Row
            label="最小化到托盘"
            desc="最小化时直接收进托盘，任务栏里不留条目；从托盘点回来恢复原窗口。"
            id="general-minimize"
          >
            <Toggle
              checked={settings.minimizeToTray}
              label="最小化到托盘"
              disabled={page.busy}
              onChange={(next) => void page.setMinimizeToTray(next)}
            />
          </Row>
          <Row
            label="点一下托盘图标"
            desc="「显示 / 隐藏」在窗口已在前台时把它收回去；「只显示」不会把窗口藏起来。"
            id="general-tray"
          >
            <Choice
              value={settings.trayClick}
              options={TRAY_OPTIONS}
              label="点一下托盘图标"
              disabled={page.busy}
              onChange={(next) => void page.setTrayClick(next)}
            />
          </Row>
          <Row label="窗口显示" desc="全屏播放页；F11 是同一个动作。" id="general-fullscreen">
            <button className="btn" onClick={() => void bridge.window.toggleFullscreen()}>
              切换全屏
            </button>
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard title="性能" hint="这两项都跟整机有关，不影响音质。">
        <Rows>
          <Row
            label="放歌时阻止系统休眠"
            desc="只拦睡眠与休眠，不拦屏幕关闭；暂停播放后立刻还回去。"
            id="general-sleep"
          >
            <Toggle
              checked={settings.preventSleepWhilePlaying}
              label="放歌时阻止系统休眠"
              disabled={page.busy}
              onChange={(next) => void page.setPreventSleep(next)}
            />
          </Row>
          <Row
            label="界面缩放"
            desc="整页等比放大或缩小，适合高 DPI 屏或离得远的时候；重载后仍会应用。"
            id="general-zoom"
            stack
          >
            <div className="settings__slider">
              <input
                type="range"
                min={50}
                max={150}
                step={5}
                value={zoomPercent}
                aria-label="界面缩放"
                onChange={(event) => setZoomDraft(Number(event.target.value))}
                onPointerUp={commitZoom}
                onKeyUp={commitZoom}
              />
              <span className="settings__number">{zoomPercent}%</span>
            </div>
          </Row>
        </Rows>
      </SettingsCard>

      <Note>缩放过大而窗口又太小时，主页与播放页会按窗口最小宽度重排；设置页本身也会跟着缩放。</Note>
    </>
  )
}
