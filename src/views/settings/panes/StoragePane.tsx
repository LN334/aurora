import { useEffect, useState } from 'react'
import { bridge } from '../../../bridge'
import { cacheLimitLabel, cacheSizeLabel } from '../../../features/settings/cache-format'
import { formatBytes } from '../../../features/settings/store'
import type { useSettingsPage } from '../../../features/settings/store'
import type { JunkId, MediaCacheStats } from '../../../env'
import { Actions, Note, Row, Rows, SettingsCard } from '../parts'

/** 在线缓存的几档上限。固定档位比滑块好点，也更好解释「不缓存」这个真实选项。 */
const CACHE_LIMITS = [0, 512, 1024, 2048, 5120, 10_240]

const ALL_JUNK: JunkId[] = ['cache', 'logs', 'crashes']

/**
 * 存储与清理。
 *
 * 三种东西分开：在线音频缓存（可清、可限）、Chromium 自己的垃圾（日志、崩溃转储、
 * 界面缓存）、数据目录总占用。以前这些散在「下载」和「维护」两页里，用户找不到
 * 「到底谁占了我的盘」的答案；现在同一页从上到下就是这三个数字。
 */
export function StoragePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const [cache, setCache] = useState<MediaCacheStats | null>(null)
  const [cacheBusy, setCacheBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const readCache = async (): Promise<void> => {
    setCache(await bridge.mediaCache.stats())
  }

  useEffect(() => {
    let alive = true
    void bridge.mediaCache.stats().then((value) => {
      if (alive) setCache(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const changeLimit = async (megabytes: number): Promise<void> => {
    setCacheBusy(true)
    try {
      await page.setMediaCacheLimit(megabytes)
      await readCache()
    } finally {
      setCacheBusy(false)
    }
  }

  const clearAudio = async (): Promise<void> => {
    setCacheBusy(true)
    try {
      setCache(await bridge.mediaCache.clear())
    } finally {
      setCacheBusy(false)
    }
  }

  const junk = page.junk

  return (
    <>
      <SettingsCard
        title="在线缓存"
        hint="听过的在线歌会先落到盘上，下次再放就不用重新取流。缓存只是副本，删掉不影响收藏与歌单。"
      >
        <Rows>
          <Row
            label="上限"
            desc="超过上限时按最久没听的先丢。0 表示完全不缓存，最省盘但也最费流量。"
            id="storage-limit"
          >
            <div className="seg" role="group" aria-label="在线缓存上限">
              {CACHE_LIMITS.map((megabytes) => (
                <button
                  key={megabytes}
                  type="button"
                  className={megabytes === page.settings.mediaCacheLimitMb ? 'is-active' : ''}
                  disabled={cacheBusy || page.busy}
                  onClick={() => void changeLimit(megabytes)}
                >
                  {cacheLimitLabel(megabytes)}
                </button>
              ))}
            </div>
          </Row>
          <Row label="占用" desc="首数与体积都是此刻磁盘上的实际值。" id="storage-usage" title={cache?.directory}>
            <div className="dlp__dir">
              <span className="dlp__path" title={cache?.directory}>
                {cache ? cacheSizeLabel(cache.bytes) + ' · ' + cache.entries + ' 首' : '读取中…'}
              </span>
              <button
                className="btn btn--ghost"
                type="button"
                disabled={cacheBusy || !cache || cache.entries === 0}
                onClick={() => void clearAudio()}
              >
                清空
              </button>
              <button
                className="btn btn--ghost"
                type="button"
                disabled={cacheBusy}
                onClick={() => void bridge.mediaCache.openFolder()}
              >
                打开
              </button>
            </div>
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard
        title="磁盘占用"
        hint="曲库、登录状态与下载的歌都在数据目录里；这里清掉的只有可再生文件。"
      >
        <Rows>
          <Row label="数据目录" desc="设置、缓存、日志与下载记录都在这一处；打开后可以自己备份或搬走。" title={page.storage?.userData}>
            <div className="dlp__dir">
              <span className="dlp__path" title={page.storage?.userData}>
                {page.storage?.userDataBytes != null
                  ? formatBytes(page.storage.userDataBytes)
                  : '测量中…'}
              </span>
              <button className="btn" type="button" onClick={() => void bridge.maintenance.openDataDir()}>
                打开
              </button>
            </div>
          </Row>
          <Row label="垃圾文件" desc="日志与崩溃转储可以立刻删；界面缓存被 Chromium 占着，下次启动前才清得掉。" id="storage-junk">
            <div className="settings__control-stack">
              {junk ? (
                <span className="settings__number">
                  {formatBytes(junk.totalBytes)}
                  {junk.deferredBytes > 0 ? `（下次启动再清 ${formatBytes(junk.deferredBytes)}）` : ''}
                </span>
              ) : null}
              <button className="btn" type="button" disabled={page.junkBusy} onClick={() => void page.scanJunk()}>
                {page.junkBusy ? '正在测量' : junk ? '重新扫描' : '扫描'}
              </button>
              {junk && junk.totalBytes > 0 ? (
                <button className="btn btn--danger" type="button" onClick={() => setConfirming(true)}>
                  清理
                </button>
              ) : null}
            </div>
          </Row>
        </Rows>
        {junk ? (
          <Actions>
            {junk.parts.map((part) => (
              <span key={part.id} className="settings__aside">
                {part.label} {formatBytes(part.bytes)}
              </span>
            ))}
          </Actions>
        ) : null}
        {confirming ? (
          <>
            <p className="settings__confirm">
              立即删除日志与崩溃转储；界面缓存会排到下次启动前再清。曲库、登录状态与在线缓存的歌都不受影响。
            </p>
            <div className="settings__danger">
              <button
                className="btn btn--danger"
                disabled={page.junkBusy}
                onClick={() => {
                  setConfirming(false)
                  void page.cleanJunk(ALL_JUNK).then(() => page.refreshStorage())
                }}
              >
                {page.junkBusy ? '正在清理' : '确认清理'}
              </button>
              <button className="btn" type="button" onClick={() => setConfirming(false)}>
                取消
              </button>
            </div>
          </>
        ) : null}
      </SettingsCard>

      <Note>清理界面缓存后，第一次打开某些页面会略慢；这是重新生成的代价，不是数据丢了。</Note>
    </>
  )
}
