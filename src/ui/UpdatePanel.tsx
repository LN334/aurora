import { useEffect, useState } from 'react'
import { bridge, isNative } from '../bridge'
import { useUpdate } from '../features/updates/store'
import { Refresh } from './icons'

/**
 * 设置页的更新面板。
 *
 * 这一屏是手动那条路：
 * 1. 检查更新——只问 GitHub 一句，不下载、不安装；
 * 2. 下载——把文件取回来，进度显示在下面；
 * 3. 重启并安装——由人按。
 *
 * 自动那条路不经过这里的按钮：主进程按设置的频率自己查、自己下，下好之后
 * 由 src/features/updates/auto-restart.ts 在没放歌时装上并重启。两条路共用下面
 * 的状态，因为它们回答的是同一个问题（有没有新版、下到哪了），各存一份就会
 * 出现「后面说下载完了，这里还在让我下载」。
 *
 * 唯一由这里决定的是「现在装」：自动那条可能还在等一首歌放完，用户想立刻装
 * 时按这个按钮就行。
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
              </div>
            </>
          ) : result.state === 'downloading' ? (
            <>
              <p>正在下载 {Math.round(result.percent)}%</p>
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
