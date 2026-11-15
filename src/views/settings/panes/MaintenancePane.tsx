import { useState } from 'react'
import type { JunkId } from '../../../env'
import { formatBytes, useSettingsPage } from '../../../features/settings/store'
import { bridge } from '../../../bridge'
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
  const [backupNote, setBackupNote] = useState('')
  const junk = page.junk
  const memory = page.memory

  async function runExport() {
    setBackupBusy(true)
    try {
      const result = await bridge.maintenance.exportBackup(storageSnapshot())
      setBackupNote(
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
        setBackupNote(`没有导入：${result.reason}`)
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
      setBackupNote(
        `已导入 ${result.summary}，写回 ${written} 项；重启后生效。导入前的旧数据留在 backup-before-restore。`
      )
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <>
      <Sub title="内存">
        <Rows>
          <Row
            label="释放内存"
            hint="把空闲页面的内存还给系统。"
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

      <Sub title="垃圾文件" hint="界面缓存、日志与崩溃转储。听过的歌留在「下载」那边的在线缓存里，这里不动它。">
        {junk ? (
          <Rows>
            {junk.parts.map((part) => (
              <Row key={part.id} label={part.label}>
                <span className="settings__number">{formatBytes(part.bytes)}</span>
              </Row>
            ))}
            <Row label="合计" hint="上面这几项加起来。">
              <span className="settings__number">{formatBytes(junk.totalBytes)}</span>
            </Row>
            <Row
              label="整个数据目录"
              hint="曲库、歌单、登录状态、在线缓存与日志都在这里。"
              title={page.storage?.userData}
            >
              <span className="settings__number">
                {page.storage?.userDataBytes != null
                  ? formatBytes(page.storage.userDataBytes)
                  : '…'}
              </span>
            </Row>
            {junk.cleanedBytes > 0 ? (
              <Row label="已清理">
                <span className="settings__number">{formatBytes(junk.cleanedBytes)}</span>
              </Row>
            ) : null}
            {junk.deferredBytes > 0 ? (
              <Row
                label="下次启动再清"
                hint="播放器占用中，下次启动前清掉。"
              >
                <span className="settings__number">{formatBytes(junk.deferredBytes)}</span>
              </Row>
            ) : null}
          </Rows>
        ) : (
          <p className="settings__hint">
            {page.junkBusy ? '正在测量…' : '还没有测量。'}
          </p>
        )}

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
        hint="把设置、曲库、歌单与收听记录打进一个文件。登录状态不进备份 —— 换了机器重新登录就行。"
      >
        <Rows>
          <Row label="导出备份" hint="选个位置存下来，文件名带时间。">
            <button className="btn" disabled={backupBusy} onClick={() => void runExport()}>
              {backupBusy ? '请稍候' : '导出'}
            </button>
          </Row>
          <Row
            label="导入备份"
            hint="会覆盖当前数据；导入前旧文件自动留在 backup-before-restore 里。"
          >
            <button className="btn" disabled={backupBusy} onClick={() => void runRestore()}>
              {backupBusy ? '请稍候' : '导入'}
            </button>
          </Row>
        </Rows>
        {backupNote ? <p className="settings__hint">{backupNote}</p> : null}
      </Sub>
    </>
  )
}
