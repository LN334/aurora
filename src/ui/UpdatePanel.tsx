import { useEffect, useState } from 'react'
import { bridge, isNative } from '../bridge'
import { useUpdate } from '../features/updates/store'
import { Refresh } from './icons'

/**
 * 设置页的更新面板。
 *
 * 状态从全应用共用的 store 读，而不是自己再查一遍：自动下载与这里回答的是
 * 同一个问题，两处各存一份就会出现「后面说下载完了，这里还在让我下载」。
 *
 * 下载放在应用内（安装包未签名，装之前一定会再问一次），替换运行中的程序仍然
 * 只能由人按——这里给的是按钮，不是自动执行。
 */
export function UpdatePanel() {
  const [version, setVersion] = useState('—')
  const result = useUpdate((state) => state.result)
  const busy = useUpdate((state) => state.busy)
  const check = useUpdate((state) => state.check)
  const download = useUpdate((state) => state.download)
  const install = useUpdate((state) => state.install)

  useEffect(() => {
    void bridge.info().then((info) => setVersion(info.version))
  }, [])

  return (
    <section className="update">
      <div className="update__row">
        <div className="update__version">
          <span className="update__label">当前版本</span>
          <span className="update__number tnum">{version}</span>
        </div>

        {isNative ? (
          <button className="btn" onClick={() => void check()} disabled={busy}>
            <Refresh size={15} />
            {busy ? '正在检查' : '检查更新'}
          </button>
        ) : null}
      </div>

      {result ? (
        <div className={`update__result${result.state === 'available' ? ' is-available' : ''}`}>
          {result.state === 'current' ? (
            <p>已是最新的正式版本</p>
          ) : result.state === 'available' ? (
            <>
              <p className="update__headline">
                有新版本 <strong>{result.info.version}</strong>
                {result.info.name && result.info.name !== `Aurora ${result.info.version}`
                  ? ` · ${result.info.name}`
                  : ''}
              </p>
              {result.info.notes ? <pre className="update__notes">{result.info.notes}</pre> : null}
              <div className="update__actions">
                <button className="btn btn--accent" onClick={() => void download()} disabled={busy}>
                  下载 {result.info.version}
                </button>
              </div>
            </>
          ) : result.state === 'downloading' ? (
            <p>正在下载 {Math.round(result.percent)}%</p>
          ) : result.state === 'ready' ? (
            <>
              <p>新版本已下载好，重启后换成新版本</p>
              <div className="update__actions">
                <button className="btn btn--accent" onClick={() => void install()}>
                  重启并安装
                </button>
              </div>
            </>
          ) : result.state === 'installing' ? (
            <p>正在安装，应用即将重启</p>
          ) : (
            // `unconfigured` 与 `error` 是剩下的两个，都带一句给人看的话。
            <p>{result.message}</p>
          )}
        </div>
      ) : null}

    </section>
  )
}
