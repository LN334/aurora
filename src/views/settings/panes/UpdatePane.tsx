import { useEffect, useState } from 'react'
import { bridge, isNative } from '../../../bridge'
import { useSettingsPage } from '../../../features/settings/store'
import { UpdatePanel } from '../../../ui/UpdatePanel'
import { Choice, Note, Row, Rows, SettingsCard, Toggle } from '../parts'
import {
  ISSUES_URL,
  issueUrl,
  platformLabel,
  rendererLabel,
  REPO_URL,
  versionLabel
} from '../../../features/settings/about'

/**
 * 更新与关于。
 *
 * 自动只做到「替你查一下」：查到新版本弹一张「发现新版本」，下载与安装都得
 * 自己按。这样界面上写着的每一件事都真的会发生，也不会有后台悄悄把安装包
 * 拉回来、再找时机换掉进程。
 *
 * 版本信息与仓库链接留在这一屏：它们回答的是「这个应用现在是什么状态，坏了去哪」。
 * 导出日志搬到了维护页——那是诊断动作，不是版本信息。
 */
export function UpdatePane({ page }: { page: ReturnType<typeof useSettingsPage> }) {
  const { updateInterval } = page.settings

  return (
    <>
      <SettingsCard
        title="更新"
        hint="只检查有没有新版本，不会自己下载，也不会自己替换进程。"
      >
        <Rows>
          {/*
           * 「自动检查」和「检查频率」原来并排两行：频率里又有一个「手动」档，
           * 跟上面那颗「检查更新」按钮说的是同一件事，读起来像三个开关管一件事。
           * 现在合成一个：开关管「要不要自己查」，频率只在开着时出现。
           */}
          <Row
            label="自动检查"
            desc="开着时按下面频率在启动后查一次；查到会弹提示，你按了才下载。"
            id="update-auto"
          >
            <Toggle
              checked={updateInterval !== 'manual'}
              disabled={page.busy}
              label="自动检查"
              onChange={(next) => void page.setUpdateInterval(next ? 'daily' : 'manual')}
            />
          </Row>
          {updateInterval !== 'manual' ? (
            <Row label="检查频率" desc="只影响检查，不影响已经下载好的包；手动检查任何时候都能点。">
              <Choice
                value={updateInterval}
                options={[
                  { id: 'daily', name: '每天' },
                  { id: 'weekly', name: '每周' }
                ]}
                label="更新检查频率"
                disabled={page.busy}
                onChange={(next) => void page.setUpdateInterval(next)}
              />
            </Row>
          ) : null}
        </Rows>
      </SettingsCard>

      <SettingsCard title="当前版本" hint="手动检查、下载进度与安装按钮都在这一块里。">
        <UpdatePanel />
      </SettingsCard>

      <SettingsCard title="关于" hint="版本与运行环境对不上时，先确认界面是不是热更过。">
        <About />
      </SettingsCard>
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
  /*
   * 界面这一份的指纹可能缺：热更界面比安装包新时，旧主进程给的 info 里
   * 根本没有 renderer 这一项。所以这里整条链都按「可能没有」取。
   */
  const rendererHash = info?.renderer?.hash ?? ''

  return (
    <>
      <p className="settings__notice">
        Aurora 由 AI 生成，是试验性作品而非成熟产品，功能与界面可能随时改动。请勿用于重要数据。
      </p>
      <dl className="specs">
        <dt>版本</dt>
        <dd className="tnum">{info ? versionLabel(info.version) : '—'}</dd>
        {/*
         * 版本号来自安装包，界面却可能来自本机热更：两个数对不上是常态，不是
         * 出错。把界面那一份的版本与写入时间摊开，才不用去翻 startup.log 猜。
         */}
        <dt>界面</dt>
        <dd title={rendererHash ? '产物 ' + rendererHash : undefined}>
          {rendererLabel(info?.renderer)}
        </dd>
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
        <Row label="项目主页" desc="源码、更新日志与已知问题都在这里。" id="update-about">
          <button className="btn btn--small" onClick={() => open(REPO_URL)}>
            github.com/LN334/aurora ↗
          </button>
        </Row>
        <Row label="反馈问题" desc="会预填版本与运行环境；导出日志在维护页。">
          <button className="btn btn--small" onClick={() => open(issueUrl(facts))}>
            反馈 ↗
          </button>
        </Row>
        <Row label="开源协议" desc="MIT，可自行修改与分发。">
          <span className="specs__path">MIT</span>
        </Row>
        <Row label="已提的问题" desc="看看别人遇到过什么，或确认是不是已知问题。">
          <button className="btn btn--small" onClick={() => open(ISSUES_URL)}>
            打开 Issue 列表 ↗
          </button>
        </Row>
      </Rows>
      <Note>
        这个版本不会自动安装更新；下载完会提示重启，由你自己点。
      </Note>
    </>
  )
}
