import { useEffect, useState } from 'react'
import { bridge, isNative } from '../bridge'
import { formatBytes } from '../features/settings/store'
import { useUpdate } from '../features/updates/store'
import { Refresh } from './icons'

/**
 * 设置页的更新面板。
 *
 * 三步都由人按：
 * 1. 检查更新——只问 GitHub 一句，不下载、不安装；
 * 2. 下载——把文件取回来，进度显示在下面；
 * 3. 重启并安装。
 *
 * 主进程的定时检查只负责把「有新版本」这件事推到界面上（右下角提示条 +
 * 「发现新版本」对话框），它既不下文件也不换进程。所以这一屏没有任何开关会
 * 让应用在用户不知情的时候被替换。
 */
export function UpdatePanel() {
  const [version, setVersion] = useState('—')
  const result = useUpdate((state) => state.result)
  const busy = useUpdate((state) => state.busy)
  const check = useUpdate((state) => state.check)
  const download = useUpdate((state) => state.download)
  const install = useUpdate((state) => state.install)
  const open = useUpdate((state) => state.open)

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
              {/*
               * 手动这条路只回答两件事：哪一版、多大。发布说明有一整页，塞进
               * 设置页会把「要不要现在下」这个决定淹掉；想看内容去更新公告或
               * 发布页。
               */}
              <p className="update__headline">
                有新版本 <strong>{result.info.version}</strong>
                {result.info.size > 0 ? ` · ${formatBytes(result.info.size)}` : ''}
              </p>
              {/*
               * 发布说明只露三行，多出来的用省略号收掉：想先知道这版改了什么，
               * 三行够判断「要不要现在下」；要全文就去更新公告或发布页。
               */}
              {result.info.notes ? <p className="update__notes">{result.info.notes}</p> : null}
              <div className="update__actions">
                <button className="btn btn--accent" onClick={() => void download()} disabled={busy}>
                  下载 {result.info.version}
                </button>
                <button className="btn" onClick={() => void open()}>
                  打不开？手动下载
                </button>
              </div>
            </>
          ) : result.state === 'downloading' ? (
            <>
              <p>正在下载 {Math.round(result.percent)}%</p>
              <div className="update__actions">
                <button className="btn" onClick={() => void open()}>
                  卡住了？改用浏览器下载
                </button>
              </div>
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
          ) : result.state === 'error' ? (
            <>
              <p>{result.message}</p>
              <div className="update__actions">
                <button className="btn" onClick={() => void check()} disabled={busy}>
                  重新检查
                </button>
                <button className="btn" onClick={() => void open()}>
                  打开发布页
                </button>
              </div>
            </>
          ) : (
            // 只剩 `unconfigured`：没有发布仓库，也就没有页面可开。
            <p>{result.message}</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
