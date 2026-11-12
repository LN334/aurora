import { useEffect, useState } from 'react'
import { bridge, isNative } from '../bridge'
import { useUpdate } from '../features/updates/store'
import { Refresh } from './icons'

/**
 * 设置页的更新面板。
 *
 * 三步分开、各自一个动作，谁都不替下一步做主：
 * 1. 检查更新——只是问一句，不下载、不安装；
 * 2. 下载——把文件取回来，进度显示在下面；
 * 3. 重启并安装——由人按。收窗口不装，退出也不装（见 electron/main.ts 与
 *    electron/updates.ts 的 autoInstallOnAppQuit），安装包未签名，替用户做这个
 *    决定没有回退的路。
 *
 * 状态从全应用共用的 store 读，而不是自己再查一遍：自动下载与这里回答的是
 * 同一个问题，两处各存一份就会出现「后面说下载完了，这里还在让我下载」。
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
            <p>已是最新版本 {version}</p>
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
                <span className="update__hint">只下载，不会自己装。最后一步永远等你按。</span>
              </div>
            </>
          ) : result.state === 'downloading' ? (
            <>
              <p>正在下载 {Math.round(result.percent)}%</p>
              <span className="update__hint">
                下好之后由你决定什么时候装。这会儿退出应用，这份下载要重来。
              </span>
            </>
          ) : result.state === 'ready' ? (
            <>
              <p>
                <strong>{result.info.version}</strong> 已经下载好
              </p>
              <div className="update__actions">
                <button className="btn btn--accent" onClick={() => void install()}>
                  重启并安装
                </button>
                <span className="update__hint">
                  点了会关掉应用，装完自动回来。先不装也行，但重新打开应用后要重新下载。
                </span>
              </div>
            </>
          ) : result.state === 'installing' ? (
            <p>正在安装，应用马上会重启</p>
          ) : (
            // `unconfigured` 与 `error` 是剩下的两个，都带一句给人看的话。
            <p>{result.message}</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
