import { useEffect, useState } from 'react'
import { bridge, isNative } from '../bridge'
import { useUpdate } from '../features/updates/store'
import { Refresh } from './icons'

/**
 * 设置页的更新面板。
 *
 * 状态从全应用共用的 store 读，而不是自己再查一遍：横幅与这里回答的是同一个
 * 问题，两处各存一份就会出现「横幅说下载完了，设置页还在让我下载」。
 *
 * 下载放在应用内（安装包未签名，装之前一定会再问一次），替换运行中的程序仍然
 * 只能由人按——这里给的是按钮，不是自动执行。
 */
export function UpdatePanel() {
  const [version, setVersion] = useState('—')
  const [autoCheck, setAutoCheck] = useState(true)
  const result = useUpdate((state) => state.result)
  const busy = useUpdate((state) => state.busy)
  const check = useUpdate((state) => state.check)
  const download = useUpdate((state) => state.download)
  const install = useUpdate((state) => state.install)
  const open = useUpdate((state) => state.open)

  useEffect(() => {
    void bridge.info().then((info) => setVersion(info.version))
    if (isNative) void bridge.updates.getAutoCheck().then(setAutoCheck)
  }, [])

  const toggleAuto = async (enabled: boolean) => {
    setAutoCheck(await bridge.updates.setAutoCheck(enabled))
  }

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
                <button className="btn" onClick={() => void open()}>
                  更新内容
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

      {isNative ? (
        <div className="update__row update__row--quiet">
          <div>
            <div className="update__label">每天自动检查一次</div>
            <p className="update__hint">发现新版本时会自动下载，换版本前仍需你点一次。安装包未签名</p>
          </div>
          <button
            className={`switch${autoCheck ? ' is-on' : ''}`}
            role="switch"
            aria-checked={autoCheck}
            onClick={() => void toggleAuto(!autoCheck)}
            aria-label="每天自动检查更新"
          >
            <span className="switch__dot" />
          </button>
        </div>
      ) : null}
    </section>
  )
}
