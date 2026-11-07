import { useState } from 'react'
import type { JunkId } from '../../../env'
import { formatBytes, useSettingsPage } from '../../../features/settings/store'
import { Actions, Row, Rows, Sub } from '../parts'

const ALL_JUNK: JunkId[] = ['cache', 'logs', 'crashes']

/**
 * 05 清理与维护。
 *
 * 照 PCL2 百宝箱那两件事做的：一个是把工作集还给系统，一个是把可再生的垃圾删掉。
 * 两者都不提供「自动清理」——动磁盘与动内存应该由人点，而不是后台自己来。
 */
export function MaintenancePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const [confirming, setConfirming] = useState(false)
  const junk = page.junk
  const memory = page.memory

  return (
    <>
      <Sub title="内存">
        <Rows>
          <Row
            label="释放内存"
            hint="把当前用不到的页面内存交还系统。播放不会中断，切回某个页面时它会重新加载。"
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

      <Sub title="垃圾文件" hint="缓存、日志与崩溃转储。删掉只是要重新下载，不会动曲库、歌单、档案与登录状态。">
        {junk ? (
          <Rows>
            {junk.parts.map((part) => (
              <Row key={part.id} label={part.label}>
                <span className="settings__number">{formatBytes(part.bytes)}</span>
              </Row>
            ))}
            <Row label="合计" hint={`数据目录：${page.storage?.userData ?? '—'}`}>
              <span className="settings__number">{formatBytes(junk.totalBytes)}</span>
            </Row>
            {junk.cleanedBytes > 0 ? (
              <Row label="已清理" hint="这部分已经真的让出来了。">
                <span className="settings__number">{formatBytes(junk.cleanedBytes)}</span>
              </Row>
            ) : null}
            {junk.deferredBytes > 0 ? (
              <Row
                label="下次启动再清"
                hint="GPU 缓存被播放器一直打开，Windows 不让删。下次启动会先清掉它再进界面。"
              >
                <span className="settings__number">{formatBytes(junk.deferredBytes)}</span>
              </Row>
            ) : null}
          </Rows>
        ) : (
          <p className="settings__hint">
            {page.junkBusy ? '正在测量…' : '还没有测量。点「扫描」看看占了多少。'}
          </p>
        )}

        {confirming ? (
          <>
            <p className="settings__confirm">
              日志与崩溃转储现在删掉；缓存被播放器占着文件，会在下次启动前清掉。曲库索引、播放列表、档案和登录状态不会被动。
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
    </>
  )
}
