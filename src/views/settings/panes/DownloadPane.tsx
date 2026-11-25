import { useDownloads } from '../../../features/downloads/store'
import type { useSettingsPage } from '../../../features/settings/store'
import type { DownloadFormat } from '../../../env'
import { Choice, Note, Row, Rows, SettingsCard, Toggle } from '../parts'

const FORMATS: { value: DownloadFormat; label: string; hint: string }[] = [
  { value: 'original', label: '原格式', hint: '平台给什么就存什么，最快，不重新编码。' },
  { value: 'mp3', label: 'MP3', hint: '兼容性最好，车机与老设备都认。' },
  { value: 'flac', label: 'FLAC', hint: '无损，文件大；源本身是有损的话不会变好。' },
  { value: 'm4a', label: 'M4A', hint: 'AAC 编码，同码率下比 MP3 小。' }
]

const BITRATES = [128, 192, 256, 320]

/**
 * 下载。
 *
 * 三件事：存到哪、存成什么、用什么转。后两项对「原格式」无意义——原格式只是
 * 把平台给的字节搬下来，所以选中原格式时码率那行整行禁用，而不是假装它能生效。
 * 转码依赖 ffmpeg；没有就直说，只下原格式不受影响。
 *
 * 在线缓存不在这里：它属于「存储与清理」，跟磁盘占用放在一起。
 */
export function DownloadPane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const prefs = useDownloads((state) => state.prefs)
  const setFormat = useDownloads((state) => state.setFormat)
  const setBitrate = useDownloads((state) => state.setBitrate)
  const pickDir = useDownloads((state) => state.pickDir)
  const openFolder = useDownloads((state) => state.openFolder)

  const format = prefs?.format ?? 'original'
  const bitrate = prefs?.bitrate ?? 256
  const losslessOrOriginal = format === 'original' || format === 'flac'
  const formatHint = FORMATS.find((item) => item.value === format)?.hint ?? ''

  return (
    <>
      <SettingsCard title="保存位置" hint="离线下载独立于在线缓存；在线缓存删掉不会影响已下载的歌。">
        <Rows>
          <Row
            label="保存到"
            desc="每首歌存成一个文件，文件名带歌手与曲名；文件夹可以随时改，已下载的不会搬过去。"
            id="download-dir"
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
            desc="下载结束后自动打开文件管理器并选中文件；批量下载时可能有点吵，可以关掉。"
          >
            <Toggle
              checked={page.settings.openAfterDownload}
              disabled={page.busy}
              label="下完在文件夹里显示"
              onChange={(next) => void page.setOpenAfterDownload(next)}
            />
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard
        title="格式"
        hint="转码会用掉一些时间与 CPU；高码率不会把有损源补回细节，只让它更接近原样。"
      >
        <Rows>
          <Row
            label="文件格式"
            desc={formatHint}
            id="download-format"
            stack
          >
            <Choice
              value={format}
              options={FORMATS.map((item) => ({ id: item.value, name: item.label }))}
              label="下载格式"
              onChange={(next) => void setFormat(next)}
            />
          </Row>
          <Row
            label="码率"
            desc={
              losslessOrOriginal
                ? '原格式与 FLAC 不做有损转码，所以码率选项在这里不起作用。'
                : 'MP3 与 M4A 的编码码率；越高越接近源，文件也越大。'
            }
            id="download-bitrate"
            stack
          >
            <Choice
              value={String(bitrate)}
              options={BITRATES.map((value) => ({ id: String(value), name: value + 'k' }))}
              label="下载码率"
              disabled={losslessOrOriginal}
              onChange={(next) => void setBitrate(Number(next))}
            />
          </Row>
          <Row label="转码器" desc="非原格式要本机有 ffmpeg；没有时下载会失败，并在下载列表里写明原因。">
            <span className={'dlp__badge' + (prefs?.ffmpeg ? ' is-ok' : '')}>
              {prefs?.ffmpeg ? '可用' : '未安装'}
            </span>
          </Row>
        </Rows>
      </SettingsCard>

      <Note>
        下载的是平台这次给出的音源文件。能不能下到完整一首取决于账号与版权，遇到只能试听的歌会直接标出来。
      </Note>
    </>
  )
}
