import { isNative } from '../bridge'
import { useUpdate } from '../features/updates/store'
import { ArrowUp, Close, Refresh } from './icons'

/**
 * 更新横幅。
 *
 * 放在内容区顶部而不是弹窗里：检查在启动时后台跑，用户可能正在听歌，一个
 * 模态框会把「有新版本」变成打断。一条横幅说清楚，想更新就点，不想就关掉，
 * 关掉只压住这个版本，不是永不再提。
 *
 * 下载与安装分两步，文案也分开：下载可以说「正在下载」，安装一定要人按。
 */
export function UpdateBar() {
  const result = useUpdate((state) => state.result)
  const dismissed = useUpdate((state) => state.dismissedVersion)
  const busy = useUpdate((state) => state.busy)
  const download = useUpdate((state) => state.download)
  const install = useUpdate((state) => state.install)
  const open = useUpdate((state) => state.open)
  const dismiss = useUpdate((state) => state.dismiss)

  if (!isNative || !result) return null
  if (result.state === 'current' || result.state === 'unconfigured' || result.state === 'error') return null

  const info = result.info
  if (dismissed === info.version) return null

  const downloading = result.state === 'downloading'
  const ready = result.state === 'ready'
  const installing = result.state === 'installing'
  const percent = downloading ? Math.max(0, Math.min(100, Math.round(result.percent))) : 0

  const headline = ready
    ? '新版本已经下载好'
    : installing
      ? '正在安装，应用马上重启'
      : downloading
        ? '正在下载 ' + info.version
        : 'Aurora ' + info.version + ' 可以更新'

  const hint = ready
    ? '重启后换成新版本，播放状态与设置会保留'
    : installing
      ? '安装完成前请不要关闭应用'
      : downloading
        ? percent + '%' + (result.total > 0 ? ' · ' + Math.round(result.total / 1024 / 1024) + ' MB' : '')
        : '当前 ' + result.current + ' · 在应用里直接下载，装之前会再问你一次'

  return (
    <div className={'updatebar' + (downloading ? ' is-downloading' : '')} role="status" aria-live="polite">
      <div className="updatebar__text">
        <span className="updatebar__title">{headline}</span>
        <span className="updatebar__hint">{hint}</span>
      </div>

      <div className="updatebar__tools">
        {ready ? (
          <button className="btn btn--accent updatebar__go" onClick={() => void install()}>
            <Refresh size={14} />
            重启并安装
          </button>
        ) : downloading || installing ? null : (
          <>
            <button className="btn btn--accent updatebar__go" onClick={() => void download()} disabled={busy}>
              <ArrowUp size={14} />
              更新到 {info.version}
            </button>
            <button className="updatebar__link" onClick={() => void open()} title="在浏览器里看这次更新了什么">
              更新内容
            </button>
          </>
        )}
        <button className="icon-btn updatebar__close" onClick={dismiss} title="这个版本先不提醒" aria-label="关闭更新提示">
          <Close size={14} />
        </button>
      </div>

      {downloading ? (
        <div className="updatebar__track" aria-hidden="true">
          <div className="updatebar__fill" style={{ width: percent + '%' }} />
        </div>
      ) : null}
    </div>
  )
}
