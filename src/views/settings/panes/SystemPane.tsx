import type { useSettingsPage } from '../../../features/settings/store'
import { useSessionRestore, writeSessionRestore } from '../../../features/settings/session-restore'
import { Row, Rows, Toggle } from '../parts'

/**
 * 启动与系统。
 *
 * 从「外观与桌面」里分出来的三行。它们都不改界面的样子，改的是这个程序
 * 在系统里怎么存在：开机时要不要出现、关窗之后还在不在、放歌时拦不拦休眠。
 * 混在外观里读起来像是又一个视觉开关，实际后果比换个壁纸重得多。
 */
export function SystemPane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const { closeToTray, launchAtLogin, preventSleepWhilePlaying, trayClick } = page.settings
  const restoreQueue = useSessionRestore()

  return (
    <Rows>
      <Row
        label="开机自启"
        hint="开机后在托盘里等你，不弹窗口。打包版才生效，源码运行不注册。"
      >
        <Toggle
          checked={launchAtLogin}
          disabled={page.busy}
          label="开机自启"
          onChange={(next) => void page.setLaunchAtLogin(next)}
        />
      </Row>

      <Row
        label="放歌时阻止系统休眠"
        hint="只拦系统挂起；屏幕该黑还是黑，按你自己的电源计划走。"
      >
        <Toggle
          checked={preventSleepWhilePlaying}
          disabled={page.busy}
          label="放歌时阻止系统休眠"
          onChange={(next) => void page.setPreventSleep(next)}
        />
      </Row>

      <Row
        label="启动时恢复上次队列"
        hint="下次打开还是上次那一列，停在 0:00 等你按播放。不记播放进度。"
      >
        <Toggle
          checked={restoreQueue}
          label="启动时恢复上次队列"
          onChange={(next) => writeSessionRestore(next)}
        />
      </Row>

      <Row
        label="点一下托盘图标"
        hint="选「只显示」时，点它不会把窗口收起来——想点开看一眼却点没了，这一档防的就是这个。"
      >
        <div className="seg">
          <button
            className={trayClick === 'toggle' ? 'is-active' : ''}
            aria-pressed={trayClick === 'toggle'}
            disabled={page.busy}
            onClick={() => void page.setTrayClick('toggle')}
          >
            显示 / 隐藏
          </button>
          <button
            className={trayClick === 'show' ? 'is-active' : ''}
            aria-pressed={trayClick === 'show'}
            disabled={page.busy}
            onClick={() => void page.setTrayClick('show')}
          >
            只显示
          </button>
        </div>
      </Row>

      <Row label="点关闭按钮时" hint="收进托盘时窗口消失、继续播放。">
        <div className="seg">
          <button
            className={closeToTray ? 'is-active' : ''}
            aria-pressed={closeToTray}
            disabled={page.busy}
            onClick={() => void page.setCloseToTray(true)}
          >
            收进托盘
          </button>
          <button
            className={closeToTray ? '' : 'is-active'}
            aria-pressed={!closeToTray}
            disabled={page.busy}
            onClick={() => void page.setCloseToTray(false)}
          >
            退出应用
          </button>
        </div>
      </Row>
    </Rows>
  )
}
