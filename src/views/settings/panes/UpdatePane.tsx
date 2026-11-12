import { useEffect, useState } from 'react'
import { bridge, isNative } from '../../../bridge'
import {
  formatCheckedAt,
  useSettingsPage
} from '../../../features/settings/store'
import { UpdatePanel } from '../../../ui/UpdatePanel'
import { Row, Rows, Sub, Toggle } from '../parts'
import {
  ISSUES_URL,
  issueUrl,
  platformLabel,
  REPO_URL,
  versionLabel
} from '../../../features/settings/about'

/**
 * 04 更新与关于。
 *
 * 检查与下载都是主进程的事，这里保留三个入口：检查频率、新版本自动下载、以及
 * UpdatePanel 自己的「检查更新」按钮与结果。版本信息与仓库链接留在这一屏：它们回答的是「这个应用现在是什么状态，坏了去哪」。
 * 数据与缓存搬到了 05 清理与维护，因为那里还有释放内存，两件事该放在一起。
 */
export function UpdatePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const { updateInterval } = page.settings

  return (
    <>
      <Sub title="更新" hint="安装包未签名。新版本可以在应用里下好，装之前一定会问你。">
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
            label="发现新版本时自动下载"
            hint={
              page.prefs.autoInstallAvailable
                ? '后台下好，不打断你在做的事。装永远等你点「重启并安装」：收窗口不装，退出也不装。'
                : '装好的应用里才能用；开发模式只能手动下载。'
            }
          >
            <Toggle
              checked={page.prefs.autoInstall}
              disabled={page.busy || !page.prefs.autoInstallAvailable}
              label="发现新版本时自动下载"
              onChange={(next) => void page.setAutoInstall(next)}
            />
          </Row>
        </Rows>
      </Sub>

      <Sub title="关于">
        <About />
      </Sub>
    </>
  )
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

  const open = (url: string) => {
    void bridge.app.openExternal(url)
  }

  /*
   * 反馈正文预填用的事实：版本与运行环境都来自主进程，没读到就是空串，
   * 纯函数会把空串换成「未知」，不会把 undefined 写进 issue。
   */
  const facts = {
    version: info?.version ?? '',
    electron: info?.electron ?? '',
    chrome: info?.chrome ?? '',
    node: info?.node ?? '',
    platform: info?.platform ?? ''
  }

  return (
    <>
      <p className="settings__notice">
        Aurora 由 AI 生成，是试验性作品而非成熟产品，功能与界面可能随时改动。请勿用于重要数据。
      </p>
      <dl className="specs">
        <dt>版本</dt>
        <dd className="tnum">{info ? versionLabel(info.version) : '—'}</dd>
        <dt>运行环境</dt>
        <dd>{isNative ? 'Electron 桌面版' : '浏览器预览模式'}</dd>
        <dt>平台</dt>
        <dd>{info ? platformLabel(info.platform) : '—'}</dd>
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
        <Row label="项目主页" hint="源码与全部发行版。">
          <button className="btn btn--small" onClick={() => open(REPO_URL)}>
            github.com/LN334/aurora ↗
          </button>
        </Row>
        <Row label="反馈问题" hint="提 issue，自动带上版本与环境。">
          <button className="btn btn--small" onClick={() => open(issueUrl(facts))}>
            反馈 ↗
          </button>
        </Row>
        <Row label="开源协议" hint="MIT，可自用与再分发。">
          <span className="specs__path">MIT</span>
        </Row>
        <Row label="已提的问题">
          <button className="btn btn--small" onClick={() => open(ISSUES_URL)}>
            打开 Issue 列表 ↗
          </button>
        </Row>
      </Rows>
    </>
  )
}