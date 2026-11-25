import { useEffect, useState } from 'react'
import { formatBytes, useSettingsPage } from '../../../features/settings/store'
import { bridge } from '../../../bridge'
import { toast } from '../../../ui/toast'
import { Actions, Note, Row, Rows, SettingsCard } from '../parts'

/**
 * 只收自己的持久化键。
 *
 * localStorage 里可能还躺着别的东西（调试插件、主题试色），备份不该把它们
 * 当成「用户数据」一起带走。
 */
function storageSnapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key || !key.startsWith('aurora')) continue
    const value = localStorage.getItem(key)
    if (value != null) out[key] = value
  }
  return out
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/**
 * 维护。
 *
 * 把「现在占多少、能收回多少、坏了怎么带着现场走」集中在一页。它不提供自动清理：
 * 动内存与动磁盘应该由人点，而不是后台自己来。
 */
export function MaintenancePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const [backupBusy, setBackupBusy] = useState(false)
  const [restartReady, setRestartReady] = useState(false)
  const [exporting, setExporting] = useState(false)
  /*
   * 当前内存。
   *
   * 数据来自主进程的 getAppMetrics()（Chromium 自己按进程类型报的），比从外面
   * 按 exe 名聚合准——外面分不出渲染进程和工具进程。
   */
  const [memoryTotal, setMemoryTotal] = useState('')
  const [gpuNote, setGpuNote] = useState('')

  const readMetrics = async (): Promise<void> => {
    const result = await bridge.app.metrics()
    setMemoryTotal(result.summary.totalMb > 0 ? result.summary.totalMb + ' MB' : '')
  }

  /* 进页面先读一次：这一行是「我现在占多少」，不该要用户先点一下才有数。 */
  useEffect(() => {
    void readMetrics()
    void bridge.app.gpuStatus().then((status) => setGpuNote(status.summary))
  }, [])

  const memory = page.memory

  async function runExport() {
    setBackupBusy(true)
    try {
      const result = await bridge.maintenance.exportBackup(storageSnapshot())
      toast(
        result.ok ? '已保存 ' + fileName(result.path) + ' · ' + result.summary : '没有导出：' + result.reason
      )
    } finally {
      setBackupBusy(false)
    }
  }

  async function runRestore() {
    setBackupBusy(true)
    try {
      const result = await bridge.maintenance.restoreBackup()
      if (!result.ok) {
        toast('没有导入：' + result.reason)
        return
      }
      let written = 0
      for (const [key, value] of Object.entries(result.storage)) {
        try {
          localStorage.setItem(key, value)
          written += 1
        } catch {
          // 配额满了就停下：写进去一半比完全不写更难看懂。
          break
        }
      }
      toast('已导入 ' + result.summary + '，写回 ' + written + ' 项；重启后生效。')
      setRestartReady(true)
    } finally {
      setBackupBusy(false)
    }
  }

  async function exportLogs(): Promise<void> {
    setExporting(true)
    try {
      const path = await bridge.app.exportLogs()
      /* 取消保存时拿到空串：不提示，那也是一次正常结束。 */
      if (path) toast('日志已导出：' + path)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <SettingsCard
        title="系统资源"
        hint="读数是此刻的采样；刷新只重新取数，不动应用状态。"
      >
        <Rows>
          <Row
            label="当前占用"
            desc="主进程、渲染进程与工具进程的内存合计。这个数通常比任务管理器里按 exe 名聚合的准。"
            id="maintenance-memory"
          >
            {memoryTotal ? <span className="settings__number">{memoryTotal}</span> : null}
            <button className="btn" type="button" onClick={() => void readMetrics()}>
              刷新
            </button>
          </Row>
          <Row
            label="释放内存"
            desc="让 Chromium 把可回收的缓存还给系统。会把界面暂时变慢一点，正在播的歌不受影响。"
          >
            {memory ? (
              <span className="settings__number">
                {memory.freedBytes > 0 ? '已释放 ' + formatBytes(memory.freedBytes) : '没有可释放的内存'}
              </span>
            ) : null}
            <button
              className="btn"
              disabled={page.memoryBusy}
              onClick={() => void page.releaseMemory()}
            >
              {page.memoryBusy ? '正在释放' : '立即释放'}
            </button>
          </Row>
          <Row
            label="显卡加速"
            desc="没在生效通常是显卡驱动太旧或被系统策略禁用；界面仍能用，只是动画与取色会重一些。"
          >
            <span className={'settings__aside-state' + (gpuNote ? ' is-warn' : '')}>
              {gpuNote || '正常'}
            </span>
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard
        title="备份"
        hint="备份只在两个方向上动手：导出选中一个文件，导入会覆盖同名的本地偏好与设置。"
      >
        <Rows>
          <Row
            label="导出备份"
            desc="把设置与界面偏好（aurora 开头的本地项）装进一个文件；曲库与登录状态不在这里。"
            id="maintenance-backup"
          >
            <button className="btn" disabled={backupBusy} onClick={() => void runExport()}>
              {backupBusy ? '请稍候' : '导出'}
            </button>
          </Row>
          <Row
            label="导入备份"
            desc="导入后需要重启才全部生效；同一台机器上重复导入会以最后一次为准。"
          >
            <button className="btn" disabled={backupBusy} onClick={() => void runRestore()}>
              {backupBusy ? '请稍候' : '导入'}
            </button>
          </Row>
        </Rows>
        {restartReady ? (
          <Actions>
            <button className="btn" type="button" onClick={() => void bridge.app.relaunch()}>
              立即重启
            </button>
          </Actions>
        ) : null}
      </SettingsCard>

      <SettingsCard title="诊断" hint="导出文件前会先把 token、cookie、房间令牌替换掉，可以直接发给别人。">
        <Rows>
          <Row
            label="导出日志"
            desc="打包当前启动日志与版本信息，用来定位「点歌没反应」这类只在日志里出现的问题。"
            id="maintenance-logs"
          >
            <button className="btn btn--small" disabled={exporting} onClick={() => void exportLogs()}>
              {exporting ? '正在导出…' : '导出'}
            </button>
          </Row>
        </Rows>
      </SettingsCard>

      <Note>数据目录、垃圾文件与在线缓存在「存储与清理」；恢复默认在「恢复默认」。</Note>
    </>
  )
}
