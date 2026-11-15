import { useEffect, useState } from 'react'
import { isNative } from '../bridge'
import { useUpdate } from '../features/updates/store'
import { Close, Download, Refresh } from './icons'

/**
 * 右下角的更新提示条。
 *
 * 以前「有新版本」只体现为左栏设置上的一颗点：不打扰，但也容易被忽略——尤其
 * 用户从不点设置的时候。这里补一条常驻但不抢焦点的提示（不对焦、不弹模态、
 * 不挡播放条），只在三种状态下出现：
 *
 * - 查到新版本且还没处理：立即下载 / 看详情 / 先不要；
 * - 正在下载：一条细进度条，可以收起；
 * - 下载好了：手动下载的给「重启并安装」，自动下载的说明会在空闲时装。
 *
 * 「先不要」走 store 的 note()，与左栏那颗点是同一个开关，所以不会出现
 * 「条关掉了、点还亮着」这种两套记忆。
 */
export function UpdateToast() {
  const result = useUpdate((state) => state.result)
  const noted = useUpdate((state) => state.noted)
  const busy = useUpdate((state) => state.busy)
  const note = useUpdate((state) => state.note)
  const download = useUpdate((state) => state.download)
  const install = useUpdate((state) => state.install)
  const open = useUpdate((state) => state.open)

  /*
   * 下载中点「收起」只是把这一条挪走，不能走 note()：note 是给「有新版本」那次
   * 决定用的，下载已经开始了，收起不等于不再提示下载完成。所以单独记一份。
   */
  const [collapsed, setCollapsed] = useState(false)

  const state = result?.state ?? null
  useEffect(() => {
    if (state !== 'downloading') setCollapsed(false)
  }, [state])

  if (!isNative || !result) return null

  const show =
    result.state === 'ready' ||
    (result.state === 'downloading' && !collapsed) ||
    (result.state === 'available' && !noted)
  if (!show) return null

  return (
    <aside className="uptoast" role="status" aria-live="polite">
      <button
        type="button"
        className="uptoast__close"
        onClick={() => (result.state === 'available' ? note() : setCollapsed(true))}
        title={result.state === 'available' ? '先不要' : '收起'}
        aria-label={result.state === 'available' ? '先不要这次更新' : '收起下载进度'}
      >
        <Close size={13} />
      </button>

      {result.state === 'available' ? (
        <>
          <p className="uptoast__title">
            发现新版本 <strong>{result.info.version}</strong>
          </p>
          <p className="uptoast__meta">当前 {result.current}</p>
          <div className="uptoast__acts">
            <button
              type="button"
              className="btn btn--accent uptoast__main"
              onClick={() => void download()}
              disabled={busy}
            >
              <Download size={14} />
              立即下载
            </button>
            <button type="button" className="btn" onClick={() => void open()}>
              查看详情
            </button>
          </div>
        </>
      ) : null}

      {result.state === 'downloading' ? (
        <>
          <p className="uptoast__title">
            正在下载 <strong>{result.info.version}</strong>
          </p>
          <div className="uptoast__bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, Math.max(0, result.percent))}%` }} />
          </div>
          <p className="uptoast__meta tnum">{Math.round(result.percent)}%</p>
        </>
      ) : null}

      {result.state === 'ready' ? (
        <>
          <p className="uptoast__title">
            <strong>{result.info.version}</strong> 已下载好
          </p>
          <p className="uptoast__meta">
            {result.origin === 'auto'
              ? '空闲时会自动重启装好，也可以现在装。'
              : '重启一下就能用上新版。'}
          </p>
          <div className="uptoast__acts">
            <button type="button" className="btn btn--accent uptoast__main" onClick={() => void install()}>
              <Refresh size={14} />
              重启并安装
            </button>
            <button type="button" className="btn" onClick={() => void open()}>
              看这版改了什么
            </button>
          </div>
        </>
      ) : null}
    </aside>
  )
}
