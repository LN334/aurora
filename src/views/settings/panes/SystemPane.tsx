import { useEffect, useState } from 'react'
import type { useSettingsPage } from '../../../features/settings/store'
import { bridge } from '../../../bridge'
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

  /*
   * 显卡加速有没有真的在跑。
   *
   * 驱动更新、虚拟机、系统省电策略都可能把合成切回 CPU；那时壁纸不重绘、模糊
   * 发糊，界面只是一律变慢，用户完全没有线索。判定在主进程做（那边能读
   * `getGPUFeatureStatus()`），这里只显示结论，没问题就整行不出现。
   */
  const [gpuNote, setGpuNote] = useState('')
  useEffect(() => {
    void bridge.app.gpuStatus().then((status) => setGpuNote(status.summary))
  }, [])

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
        hint="记住队列，进度从 0:00 开始。"
      >
        <Toggle
          checked={restoreQueue}
          label="启动时恢复上次队列"
          onChange={(next) => writeSessionRestore(next)}
        />
      </Row>

      <Row
        label="点一下托盘图标"
        hint="选「只显示」时，点它不会收窗口。"
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

      {gpuNote ? (
        <Row label="显卡加速" hint={gpuNote + "。更新显卡驱动，或在系统里关掉省电/节能模式之后重启应用"}>
          <span className="settings__number">没在生效</span>
        </Row>
      ) : null}
    </Rows>
  )
}
