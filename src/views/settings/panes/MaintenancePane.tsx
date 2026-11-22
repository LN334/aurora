import { useEffect, useState } from 'react'
import type { JunkId } from '../../../env'
import { formatBytes, useSettingsPage } from '../../../features/settings/store'
import { bridge } from '../../../bridge'
import { showFlash } from '../../../ui/flash'
import { Actions, Row, Rows, Sub } from '../parts'

const ALL_JUNK: JunkId[] = ['cache', 'logs', 'crashes']

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
 * 05 清理与维护。
 *
 * 照 PCL2 百宝箱那两件事做的：一个是把工作集还给系统，一个是把可再生的垃圾删掉。
 * 两者都不提供「自动清理」——动磁盘与动内存应该由人点，而不是后台自己来。
 */
export function MaintenancePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const [confirming, setConfirming] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [restartReady, setRestartReady] = useState(false)
  /*
   * 当前内存。
   *
   * 数据来自主进程的 `getAppMetrics()`（Chromium 自己按进程类型报的），比从外面
   * 按 exe 名聚合准——外面分不出渲染进程和工具进程。
   */
  const [memoryTotal, setMemoryTotal] = useState('')

  const readMetrics = async (): Promise<void> => {
    const result = await bridge.app.metrics()
    setMemoryTotal(result.summary.totalMb > 0 ? result.summary.totalMb + ' MB' : '')
  }

  /* 进页面先读一次：这一行是「我现在占多少」，不该要用户先点一下才有数。 */
  useEffect(() => {
    void readMetrics()
  }, [])
  const junk = page.junk
  const memory = page.memory

  async function runExport() {
    setBackupBusy(true)
    try {
      const result = await bridge.maintenance.exportBackup(storageSnapshot())
      showFlash(
        result.ok ? `已保存 ${fileName(result.path)} · ${result.summary}` : `没有导出：${result.reason}`
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
        showFlash(`没有导入：${result.reason}`)
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
      showFlash(`已导入 ${result.summary}，写回 ${written} 项；重启后生效。`)
      setRestartReady(true)
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <>
      <Sub title="内存">
        <Rows>
          <Row
            label="当前占用"
          >
            {memoryTotal ? <span className="settings__number">{memoryTotal}</span> : null}
            <button className="btn" type="button" onClick={() => void readMetrics()}>
              刷新
            </button>
          </Row>
          <Row
            label="释放内存"
          >
            {memory ? (
              <span className="settings__number">
                {memory.freedBytes > 0
                  ? `已释放 ${formatBytes(memory.freedBytes)}`
                  : '没有可释放的内存'}
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
        </Rows>
      </Sub>

      <Sub title="垃圾文件">
        {junk ? (
          <Rows>
            {junk.parts.map((part) => (
              <Row key={part.id} label={part.label}>
                <span className="settings__number">{formatBytes(part.bytes)}</span>
              </Row>
            ))}
            <Row label="合计">
              <span className="settings__number">{formatBytes(junk.totalBytes)}</span>
            </Row>
            <Row
              label="整个数据目录"
              
              title={page.storage?.userData}
            >
              <span className="settings__number">
                {page.storage?.userDataBytes != null
                  ? formatBytes(page.storage.userDataBytes)
                  : '…'}
              </span>
              <button
                className="btn"
                type="button"
                onClick={() => void bridge.maintenance.openDataDir()}
              >
                打开
              </button>
            </Row>
            {junk.cleanedBytes > 0 ? (
              <Row label="已清理">
                <span className="settings__number">{formatBytes(junk.cleanedBytes)}</span>
              </Row>
            ) : null}
            {junk.deferredBytes > 0 ? (
              <Row
                label="下次启动再清"
              >
                <span className="settings__number">{formatBytes(junk.deferredBytes)}</span>
              </Row>
            ) : null}
          </Rows>
        ) : null}

        {confirming ? (
          <>
            <p className="settings__confirm">
              立即删除日志与崩溃转储；界面缓存下次启动前清掉。曲库、登录状态与在线缓存的歌都不受影响。
            </p>
            <div className="settings__danger">
              <button
                className="btn btn--danger"
                disabled={page.junkBusy}
                onClick={() => {
                  setConfirming(false)
                  void page.cleanJunk(ALL_JUNK)
                }}
              >
                {page.junkBusy ? '正在清理' : '确认清理'}
              </button>
              <button className="btn" onClick={() => setConfirming(false)}>
                取消
              </button>
            </div>
          </>
        ) : (
          <Actions>
            <button
              className="btn"
              disabled={page.junkBusy}
              onClick={() => void page.scanJunk()}
            >
              {page.junkBusy ? '正在测量' : junk ? '重新扫描' : '扫描'}
            </button>
            {junk && junk.totalBytes > 0 ? (
              <button className="btn btn--danger" onClick={() => setConfirming(true)}>
                清理 {formatBytes(junk.totalBytes)}
              </button>
            ) : null}
          </Actions>
        )}
      </Sub>

      <Sub
        title="备份"
      >
        <Rows>
          <Row label="导出备份">
            <button className="btn" disabled={backupBusy} onClick={() => void runExport()}>
              {backupBusy ? '请稍候' : '导出'}
            </button>
          </Row>
          <Row
            label="导入备份"
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
      </Sub>
    </>
  )
}
