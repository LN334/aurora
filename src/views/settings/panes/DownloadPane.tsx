import { useDownloads } from '../../../features/downloads/store'
import type { useSettingsPage } from '../../../features/settings/store'
import type { DownloadFormat } from '../../../env'
import { Row, Rows, Toggle } from '../parts'

const FORMATS: { value: DownloadFormat; label: string; hint: string }[] = [
  { value: 'original', label: '原格式', hint: '平台给什么就存什么，最快，不重新编码。' },
  { value: 'mp3', label: 'MP3', hint: '兼容性最好，车机与老设备都认。' },
  { value: 'flac', label: 'FLAC', hint: '无损，文件大；源本身是有损的话不会变好。' },
  { value: 'm4a', label: 'M4A', hint: 'AAC 编码，同码率下比 MP3 小。' }
]

const BITRATES = [128, 192, 256, 320]

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

  const format = prefs?.format ?? 'original'
  const bitrate = prefs?.bitrate ?? 256
  const lossy = format === 'mp3' || format === 'm4a'

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

      <p className="dlp__note">
        下载的是平台这次给出的音源文件。能不能下到完整一首取决于账号与版权，遇到只能试听的歌会直接标出来。
      </p>
    </Rows>
  )
}
