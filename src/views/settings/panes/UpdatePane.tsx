import { useEffect, useState } from 'react'
import { bridge, isNative } from '../../../bridge'
import type { UpdateResult } from '../../../env'
import {
  formatBytes,
  formatCheckedAt,
  useSettingsPage
} from '../../../features/settings/store'
import { UpdatePanel } from '../../../ui/UpdatePanel'
import { Row, Rows, Sub, Toggle } from '../parts'

const REPO_URL = 'https://github.com/LN334/aurora'

/**
 * 04 更新与关于。
 *
 * 检查更新是主进程的事，这里只保留原来那三种入口：检查频率、自动下载安装、以及
 * UpdatePanel 自己的「检查更新」按钮与结果。版本信息与仓库链接留在这一屏：它们回答的是「这个应用现在是什么状态，坏了去哪」。
 * 数据与缓存搬到了 05 清理与维护，因为那里还有释放内存，两件事该放在一起。
 */
export function UpdatePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const { updateInterval } = page.settings

  return (
    <>
      <Sub title="更新" hint="检查由主进程做；安装包未签名，所以下载与安装都交给你决定。">
        <UpdatePanel />
        <Rows>
          <Row
            label="检查频率"
            hint={
              updateInterval === 'manual'
                ? '不自动检查，只有你点「检查更新」时才联网'
                : `上次检查：${formatCheckedAt(page.prefs.lastCheck)}`
            }
          >
            <div className="seg">
              {(
                [
                  ['manual', '手动'],
                  ['daily', '每天'],
                  ['weekly', '每周']
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={updateInterval === value ? 'is-active' : ''}
                  disabled={page.busy}
                  onClick={() => void page.setUpdateInterval(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row
            label="自动下载并安装"
            hint={
              page.prefs.autoInstallAvailable
                ? '开启后，发现新版本会自动下载并在退出时安装。这意味着跳过浏览器与 SmartScreen 的提示：安装包未签名，Aurora 无法验证它将要替换成的那个文件。'
                : '当前构建不支持：需要打包后的应用，并且需要 electron-updater 依赖（见 README「更新」一节）。'
            }
          >
            <Toggle
              checked={page.prefs.autoInstall}
              disabled={page.busy || !page.prefs.autoInstallAvailable}
              label="自动下载并安装更新"
              onChange={(next) => void page.setAutoInstall(next)}
            />
          </Row>
        </Rows>
        {page.update && page.update.state !== 'current' ? (
          <UpdateStatus result={page.update} onInstall={() => void page.installUpdate()} />
        ) : null}
      </Sub>

      <Sub title="关于" hint="这个应用是什么、跑在什么上、源码在哪。">
        <About />
      </Sub>
    </>
  )
}

function UpdateStatus({
  result,
  onInstall
}: {
  result: UpdateResult
  onInstall: () => void
}) {
  if (result.state === 'downloading') {
    return (
      <p className="settings__hint">
        正在下载 {Math.round(result.percent)}%（{formatBytes(result.transferred)} /{' '}
        {formatBytes(result.total)}）
      </p>
    )
  }

  if (result.state === 'ready') {
    return (
      <div className="settings__danger">
        <button className="btn btn--accent" onClick={onInstall}>
          重启并安装
        </button>
      </div>
    )
  }

  return null
}

function About() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof bridge.info>> | null>(null)

  useEffect(() => {
    let alive = true
    void bridge
      .info()
      .then((value) => {
        if (alive) setInfo(value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      <p className="settings__notice">
        Aurora 是 AI 制作、以试验为目的的作品，不是成熟产品：代码与文案全部由 AI 生成，功能与界面可能随时改动。自动化测试只覆盖不依赖
        Electron 的纯逻辑，<strong>真实窗口从未端到端跑过</strong>。请勿用于重要数据。
      </p>
      <dl className="specs">
        <dt>运行环境</dt>
        <dd>{isNative ? 'Electron 桌面版' : '浏览器预览模式'}</dd>
        <dt>Electron</dt>
        <dd>{info?.electron ?? '—'}</dd>
        <dt>Chromium</dt>
        <dd>{info?.chrome ?? '—'}</dd>
        <dt>Node</dt>
        <dd>{info?.node ?? '—'}</dd>
        <dt>数据目录</dt>
        <dd className="specs__path">{info?.userData ?? '—'}</dd>
        {!isNative ? (
          <>
            <dt>App 渲染次数</dt>
            <dd className="tnum">
              {(window as Window & { __auroraRenders?: number }).__auroraRenders ?? 0}
            </dd>
          </>
        ) : null}
      </dl>
      <Rows>
        <Row label="GitHub 仓库" hint="源码、更新日志与问题反馈。">
          <a className="btn btn--small set-link" href={REPO_URL} target="_blank" rel="noreferrer">
            LN334/aurora ↗
          </a>
        </Row>
      </Rows>
    </>
  )
}
