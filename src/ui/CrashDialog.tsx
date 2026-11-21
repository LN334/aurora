import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { bridge } from '../bridge'
import { useLeave } from './presence'

/**
 * 「上次是异常退出的」提示。
 *
 * 不是崩溃当场弹的——那时候进程已经没了，弹窗也跟着走。这里做的是重启后补问
 * 一句：要不要把日志导出来发过去。只问一次，主进程读完就把标记清掉。
 *
 * 排版沿用「发现新版本」那张框：同一个遮罩、同一个 nm 面板，不另造一套样式。
 */
export function CrashDialog() {
  const [report, setReport] = useState<{ at: string; summary: string } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [savedTo, setSavedTo] = useState('')
  const { leaving, leave } = useLeave(180)

  useEffect(() => {
    let alive = true
    void bridge.app
      .crashReport()
      .then((value) => {
        if (alive && value) setReport(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!report) return null

  const dismiss = () => leave(() => setReport(null))

  const exportAndClose = async (): Promise<void> => {
    setExporting(true)
    try {
      const file = await bridge.app.exportLogs()
      if (file) {
        setSavedTo(file)
        return
      }
      /* 用户取消了保存：留在框上，别把提示也一起关掉。 */
    } finally {
      setExporting(false)
    }
  }

  /* 崩溃摘要可能很长，只留前几行——它只是让人认出「是哪次」。 */
  const brief = report.summary.split('\n').slice(0, 3).join('\n')

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
        aria-label="上次是异常退出的"
      >
        <h2 className="nm__title">上次是异常退出的</h2>
        <p className="updlg__versions">
          发生时间：{report.at ? report.at.replace('T', ' ').slice(0, 19) : '未知'}
        </p>
        <h3 className="updlg__head">摘要</h3>
        <pre className="updlg__notes crashdlg__brief">{brief || '（没有留下摘要）'}</pre>
        <p className="settings__notice">
          日志里记了那一次运行的过程，导出后发给我就能顺着看。token 与 cookie 会先被替换掉。
        </p>
        {savedTo ? <p className="settings__notice">已保存到 {savedTo}</p> : null}
        <div className="nm__acts">
          <button className="rh-btn" type="button" onClick={dismiss}>
            {savedTo ? '关闭' : '先不看'}
          </button>
          <button
            className="rh-btn rh-btn--main"
            type="button"
            disabled={exporting}
            onClick={() => void exportAndClose()}
          >
            {exporting ? '正在导出…' : '导出日志'}
          </button>
        </div>
      </div>
    </>,
    document.body
  )
}
