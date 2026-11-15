import { createPortal } from 'react-dom'
import { useUpdate } from '../features/updates/store'
import { cacheSizeLabel } from '../features/settings/cache-format'
import { useLeave } from './presence'

/**
 * 「发现新版本」对话框。
 *
 * 照 LightC / Ghost Downloader 的样式：标题、旧版 → 新版、一块可滚动的更新内容，
 * 底下两个按钮。点「检查更新」查到新版本会自动弹出来；右下角提示条上的
 * 「查看详情」也打开它。
 *
 * 内容来自主进程给的 release notes（GitHub 的 body）。可能很长，也可能为空——
 * 空的时候说一句「这一版没有写说明」，不要留一块空白让人以为没加载出来。
 */
export function UpdateDialog() {
  const dialog = useUpdate((state) => state.dialog)
  const result = useUpdate((state) => state.result)
  const busy = useUpdate((state) => state.busy)
  const close = useUpdate((state) => state.closeDialog)
  const download = useUpdate((state) => state.download)

  const { leaving, leave } = useLeave(180)
  const available = result?.state === 'available' ? result : null

  /* 状态跑掉了（下完了、失败了）就不该还停在这张框上。 */
  if (!dialog || !available) return null

  const { info, current } = available
  const notes = (info.notes ?? '').trim()
  const size = info.size > 0 ? cacheSizeLabel(info.size) : ''

  const dismiss = () => leave(close)

  const start = () => {
    void download()
    dismiss()
  }

  /* 挂到 body：`<main>` 有 backdrop-filter，会成为 fixed 的包含块，弹窗会偏。 */
  return createPortal(
    <>
      <div
        className={'nm__scrim' + (leaving ? ' is-closing' : '')}
        onPointerDown={dismiss}
        role="presentation"
      />
      <div
        className={'nm updlg' + (leaving ? ' is-closing' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={`发现新版本 ${info.version}`}
      >
        <h2 className="nm__title">发现新版本</h2>
        <p className="updlg__versions">
          {current} <span aria-hidden="true">→</span> {info.version}
          {size ? <span className="updlg__size">{size}</span> : null}
        </p>
        <h3 className="updlg__head">更新内容</h3>
        {notes ? (
          <pre className="updlg__notes">{notes}</pre>
        ) : (
          <p className="updlg__empty">这一版没写说明，可以直接更新。</p>
        )}
        <div className="nm__acts">
          <button className="rh-btn" type="button" onClick={dismiss} disabled={busy}>
            取消
          </button>
          <button className="rh-btn rh-btn--main" type="button" onClick={start} disabled={busy}>
            {busy ? '正在下载…' : '立即下载'}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
