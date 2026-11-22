import { useEffect, useState } from 'react'
import { bridge, isNative } from '../../../bridge'
import { useSettingsPage } from '../../../features/settings/store'
import { UpdatePanel } from '../../../ui/UpdatePanel'
import { showFlash } from '../../../ui/flash'
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
 * 自动只做到「替你查一下」：查到新版本弹一张「发现新版本」，下载与安装都得
 * 自己按。这样界面上写着的每一件事都真的会发生，也不会有后台悄悄把 136 MB
 * 拉回来、再找时机换掉进程。
 * 版本信息与仓库链接留在这一屏：它们回答的是「这个应用现在是什么状态，坏了去哪」。
 * 数据与缓存搬到了 05 清理与维护，因为那里还有释放内存，两件事该放在一起。
 */
export function UpdatePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const { updateInterval } = page.settings

  return (
    <>
      <Sub title="更新">
        <UpdatePanel />
        <Rows>
          {/*
           * 「自动检查」和「检查频率」原来并排两行：频率里又有一个「手动」档，
           * 跟上面那颗「检查更新」按钮说的是同一件事，读起来像三个开关管一件事
           * （2026-11-15 用户原话：「更新和自动更已经是一个功能了」）。
           *
           * 现在合成一个：开关管「要不要自己查」，频率只在开着时出现。
           */}
          <Row
            label="自动检查"
          >
            <Toggle
              checked={updateInterval !== 'manual'}
              disabled={page.busy}
              label="自动检查"
              onChange={(next) => void page.setUpdateInterval(next ? 'daily' : 'manual')}
            />
          </Row>
          {updateInterval !== 'manual' ? (
            <Row label="检查频率">
              <div className="seg">
                {(
                  [
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
          ) : null}
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
  /* 导出日志的两态：正在写、以及写到哪儿了（取消时是空串）。 */
  const [exporting, setExporting] = useState(false)

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
   * 导出诊断日志。
   *
   * 主进程会先把 token / cookie / 房间令牌替换掉，所以这份文件可以直接发给
   * 别人；用户取消保存时返回空串，那也算一次正常结束，不提示错误。
   */
  const exportLogs = async (): Promise<void> => {
    setExporting(true)
    try {
      const path = await bridge.app.exportLogs()
      /* 取消保存时拿到空串：不提示，那也是一次正常结束。 */
      if (path) showFlash(`日志已导出：${path}`)
    } finally {
      setExporting(false)
    }
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
        <Row label="项目主页">
          <button className="btn btn--small" onClick={() => open(REPO_URL)}>
            github.com/LN334/aurora ↗
          </button>
        </Row>
        <Row
          label="导出日志"
        >
          <button
            className="btn btn--small"
            disabled={exporting}
            onClick={() => void exportLogs()}
          >
            {exporting ? '正在导出…' : '导出'}
          </button>
        </Row>
        <Row label="反馈问题">
          <button className="btn btn--small" onClick={() => open(issueUrl(facts))}>
            反馈 ↗
          </button>
        </Row>
        <Row label="开源协议">
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