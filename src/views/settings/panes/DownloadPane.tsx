import { useEffect, useState } from 'react'
import { useDownloads } from '../../../features/downloads/store'
import type { useSettingsPage } from '../../../features/settings/store'
import { bridge } from '../../../bridge'
import type { DownloadFormat, MediaCacheStats } from '../../../env'
import { Row, Rows, Toggle } from '../parts'

const FORMATS: { value: DownloadFormat; label: string; hint: string }[] = [
  { value: 'original', label: '原格式', hint: '平台给什么就存什么，最快，不重新编码。' },
  { value: 'mp3', label: 'MP3', hint: '兼容性最好，车机与老设备都认。' },
  { value: 'flac', label: 'FLAC', hint: '无损，文件大；源本身是有损的话不会变好。' },
  { value: 'm4a', label: 'M4A', hint: 'AAC 编码，同码率下比 MP3 小。' }
]

const BITRATES = [128, 192, 256, 320]

/**
 * 在线缓存的几档上限。
 *
 * 用固定档位而不是滑块：2GB 与 2.1GB 对用户没有区别，但一行按钮比拖动条更好
 * 点，也更好解释「不缓存」这个真实存在的选项。
 */
const CACHE_LIMITS = [0, 512, 1024, 2048, 5120, 10_240]

function limitLabel(megabytes: number): string {
  if (megabytes === 0) return '不缓存'
  return megabytes >= 1024 ? `${megabytes / 1024} GB` : `${megabytes} MB`
}

/** 占用按「1.2 GB / 36 MB」报；这里不追求精确到小数第二位。 */
function sizeLabel(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

/**
 * 09 下载。
 *
 * 三件事：存到哪、存成什么、用什么转。后两项对「原格式」无意义——原格式只是
 * 把平台给的字节搬下来，所以选中原格式时码率那行整行禁用，而不是假装它能生效。
 * 转码依赖 ffmpeg；没有就直说，只下原格式不受影响。
 */
export function DownloadPane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const prefs = useDownloads((state) => state.prefs)
  const setFormat = useDownloads((state) => state.setFormat)
  const setBitrate = useDownloads((state) => state.setBitrate)
  const pickDir = useDownloads((state) => state.pickDir)
  const openFolder = useDownloads((state) => state.openFolder)

  const [cache, setCache] = useState<MediaCacheStats | null>(null)
  const [cacheBusy, setCacheBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void bridge.mediaCache.stats().then((value) => {
      if (alive) setCache(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const changeCacheLimit = async (megabytes: number): Promise<void> => {
    setCacheBusy(true)
    try {
      await page.setMediaCacheLimit(megabytes)
      setCache(await bridge.mediaCache.stats())
    } finally {
      setCacheBusy(false)
    }
  }

  const clearAudioCache = async (): Promise<void> => {
    setCacheBusy(true)
    try {
      setCache(await bridge.mediaCache.clear())
    } finally {
      setCacheBusy(false)
    }
  }

  const format = prefs?.format ?? 'original'
  const bitrate = prefs?.bitrate ?? 256
  const lossy = format === 'mp3' || format === 'm4a'
  const cacheLimit = page.settings.mediaCacheLimitMb

  return (
    <Rows>
      <Row
        label="保存到"
        hint="没改过就放在系统音乐目录下的 Aurora 文件夹。"
        title={prefs?.effectiveDir}
      >
        <div className="dlp__dir">
          <span className="dlp__path" title={prefs?.effectiveDir}>
            {prefs?.effectiveDir ?? '读取中…'}
          </span>
          <button className="btn" type="button" onClick={() => void pickDir()}>
            更改
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => void openFolder()}>
            打开
          </button>
        </div>
      </Row>

      <Row
        label="下完在文件夹里显示"
        hint="一批下完才弹一次，不会每首各开一个窗口。"
      >
        <Toggle
          checked={page.settings.openAfterDownload}
          disabled={page.busy}
          label="下完在文件夹里显示"
          onChange={(next) => void page.setOpenAfterDownload(next)}
        />
      </Row>

      <Row label="格式" hint={FORMATS.find((item) => item.value === format)?.hint}>
        <div className="seg" role="group" aria-label="下载格式">
          {FORMATS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={item.value === format ? 'is-active' : ''}
              onClick={() => void setFormat(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </Row>

      <Row
        label="码率"
        hint={
          format === 'flac'
            ? 'FLAC 是无损，不需要码率。'
            : lossy
              ? '数字越大越接近原文件，文件也越大。'
              : '选了原格式，不重新编码，码率由平台决定。'
        }
      >
        <div className={`seg${format === 'original' || format === 'flac' ? ' is-muted' : ''}`} role="group" aria-label="下载码率">
          {BITRATES.map((value) => (
            <button
              key={value}
              type="button"
              className={value === bitrate ? 'is-active' : ''}
              disabled={format === 'original' || format === 'flac'}
              onClick={() => void setBitrate(value)}
            >
              {value}k
            </button>
          ))}
        </div>
      </Row>

      <Row
        label="转码器"
        hint={
          prefs?.ffmpeg
            ? '已经找到 ffmpeg，可用的格式都能转。'
            : '没找到 ffmpeg，转码用不了。把 ffmpeg.exe 放进资源目录，或设 AURORA_FFMPEG 指向它。'
        }
      >
        <span className={`dlp__badge${prefs?.ffmpeg ? ' is-ok' : ''}`}>
          {prefs?.ffmpeg ? '可用' : '未安装'}
        </span>
      </Row>

      <Row
        label="在线缓存上限"
        hint={
          cacheLimit === 0
            ? '关掉之后，听过的歌不再留在本地，每次都重新联网取。'
            : '听过的歌存在本机，再听同一首直接读盘、不再联网。超了按最久未听先删。'
        }
      >
        <div className="seg" role="group" aria-label="在线缓存上限">
          {CACHE_LIMITS.map((megabytes) => (
            <button
              key={megabytes}
              type="button"
              className={megabytes === cacheLimit ? 'is-active' : ''}
              disabled={cacheBusy || page.busy}
              onClick={() => void changeCacheLimit(megabytes)}
            >
              {limitLabel(megabytes)}
            </button>
          ))}
        </div>
      </Row>

      <Row
        label="缓存占用"
        hint={cacheLimit === 0 ? undefined : '这部分只存音频，清掉不影响下载目录里的歌。'}
        title={cache?.directory}
      >
        <div className="dlp__dir">
          <span className="dlp__path" title={cache?.directory}>
            {cache ? `${cache.entries} 首 · ${sizeLabel(cache.bytes)}` : '读取中…'}
          </span>
          <button
            className="btn btn--ghost"
            type="button"
            disabled={cacheBusy || !cache || cache.entries === 0}
            onClick={() => void clearAudioCache()}
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

      <p className="dlp__note">
        下载的是平台这次给出的音源文件。能不能下到完整一首取决于账号与版权，遇到只能试听的歌会直接标出来。
      </p>
    </Rows>
  )
}
