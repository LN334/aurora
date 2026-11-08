import { useMemo } from 'react'
import { isNative } from '../bridge'
import { useDownloads } from '../features/downloads/store'
import type { DownloadFormat, DownloadView } from '../env'
import { Check, Close, Folder, Locate, Trash } from './icons'

const ACTIVE = new Set(['queued', 'downloading', 'transcoding'])

const FORMAT_LABEL: Record<DownloadFormat, string> = {
  original: '原格式',
  mp3: 'MP3',
  flac: 'FLAC',
  m4a: 'M4A'
}

function mb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const value = bytes / (1024 * 1024)
  return value >= 1024 ? (value / 1024).toFixed(2) + ' GB' : value.toFixed(1) + ' MB'
}

/**
 * 下载浮条。
 *
 * 放在右下角而不是塞进播放条：下载是「放着别管」的事，只在有新进度时冒出来，
 * 完成后自己塌成一行「3 个已下载」。展开后是一次性的任务列表，关掉不影响继续下。
 */
export function DownloadsDock() {
  const views = useDownloads((state) => state.views)
  const open = useDownloads((state) => state.open)
  const setOpen = useDownloads((state) => state.setOpen)
  const cancel = useDownloads((state) => state.cancel)
  const clear = useDownloads((state) => state.clear)
  const reveal = useDownloads((state) => state.reveal)
  const openFolder = useDownloads((state) => state.openFolder)

  const active = useMemo(() => views.filter((view) => ACTIVE.has(view.state)), [views])
  const done = useMemo(() => views.filter((view) => view.state === 'done'), [views])
  const failed = useMemo(() => views.filter((view) => view.state === 'failed'), [views])

  if (!isNative || views.length === 0) return null

  const percent = active.length
    ? Math.round(active.reduce((sum, view) => sum + view.percent, 0) / active.length)
    : 0
  const headline = active.length
    ? `${active.length} 个下载中 · ${percent}%`
    : done.length
      ? `${done.length} 个已下载`
      : `${failed.length} 个没下成`

  if (!open) {
    return (
      <button className="dlbar" type="button" onClick={() => setOpen(true)} title="下载队列">
        <span className={`dlbar__dot${active.length ? ' is-active' : ''}`} aria-hidden />
        <span className="dlbar__text">{headline}</span>
      </button>
    )
  }

  return (
    <section className="dlpanel" aria-label="下载队列">
      <header className="dlpanel__head">
        <span className="dlpanel__title">下载</span>
        <span className="dlpanel__count">
          {active.length ? `${active.length} 个进行中` : '没有进行中的任务'}
        </span>
        <button
          className="icon-btn dlpanel__close"
          type="button"
          onClick={() => setOpen(false)}
          title="收起"
          aria-label="收起下载队列"
        >
          <Close size={14} />
        </button>
      </header>

      <div className="dlpanel__list">
        {views.map((view) => (
          <Row key={view.id} view={view} onCancel={cancel} onReveal={reveal} />
        ))}
      </div>

      <footer className="dlpanel__foot">
        <button className="btn btn--ghost dlpanel__go" type="button" onClick={() => void openFolder()}>
          <Folder size={14} />
          打开文件夹
        </button>
        {done.length + failed.length > 0 ? (
          <button className="dlpanel__link" type="button" onClick={() => void clear()}>
            <Trash size={12} />
            清掉已结束的
          </button>
        ) : null}
      </footer>
    </section>
  )
}

function Row({
  view,
  onCancel,
  onReveal
}: {
  view: DownloadView
  onCancel(id: string): void
  onReveal(id: string): void
}) {
  const busy = ACTIVE.has(view.state)
  const label =
    view.state === 'queued'
      ? '排队中'
      : view.state === 'downloading'
        ? `${Math.round(view.percent)}% · ${mb(view.received)} / ${mb(view.total)}`
        : view.state === 'transcoding'
          ? `转码 ${Math.round(view.percent)}%`
          : view.state === 'done'
            ? FORMAT_LABEL[view.format] ?? '已保存'
            : view.state === 'failed'
              ? view.message || '没下成'
              : '已取消'

  return (
    <div className={`dlrow is-${view.state}`}>
      <div className="dlrow__text">
        <div className="dlrow__title" title={view.title}>
          {view.title}
        </div>
        <div className="dlrow__sub" title={view.subtitle}>
          {view.subtitle}
        </div>
      </div>
      <div className={`dlrow__state${view.state === 'failed' ? ' is-bad' : ''}`}>{label}</div>
      <div className="dlrow__tools">
        {busy ? (
          <button
            className="icon-btn dlrow__btn"
            type="button"
            onClick={() => onCancel(view.id)}
            title="取消"
            aria-label="取消这个下载"
          >
            <Close size={13} />
          </button>
        ) : null}
        {view.state === 'done' ? (
          <button
            className="icon-btn dlrow__btn"
            type="button"
            onClick={() => onReveal(view.id)}
            title="在文件夹中显示"
            aria-label="在文件夹中显示"
          >
            <Locate size={13} />
          </button>
        ) : null}
        {view.state === 'done' ? <Check size={13} className="dlrow__ok" /> : null}
      </div>
      {busy ? (
        <div className="dlrow__track">
          <div className="dlrow__fill" style={{ width: `${Math.max(2, view.percent)}%` }} />
        </div>
      ) : null}
    </div>
  )
}
