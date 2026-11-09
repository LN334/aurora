import { useState } from 'react'
import type { ReactNode } from 'react'
import { useSettingsPage } from '../../features/settings/store'
import { Part } from './parts'
import { AppearancePane } from './panes/AppearancePane'
import { SystemPane } from './panes/SystemPane'
import { PlaybackPane } from './panes/PlaybackPane'
import { RecommendPane } from './panes/RecommendPane'
import { DownloadPane } from './panes/DownloadPane'
import { HotkeysPane } from './panes/HotkeysPane'
import { UpdatePane } from './panes/UpdatePane'
import { MaintenancePane } from './panes/MaintenancePane'
import './settings.css'

/**
 * 设置页。
 *
 * 版式：顶上一行分区带，下面只渲染当前这一段。
 *
 * 上一版是「左目录 + 右内容」，可主窗口左边本来就有一条主导航，设置页再长出
 * 一条次导航，两列竖排并排贴在一起，读起来像栏里套栏。分区带把八件事一次
 * 平铺出来，点哪段就只留哪段——设置里几乎不需要两段对照着改。
 *
 * 这里只放偏好：怎么播、界面长什么样、键位是什么、以及版本与数据。
 * 「我是谁、登了哪些平台」不在这——它是账号页，入口是侧栏最底下那张头像，
 * 理由见 src/views/AccountView.tsx。
 */
interface SettingsSection {
  id: string
  label: string
}

interface SettingsGroup {
  id: string
  label: string
  sections: SettingsSection[]
}

const GROUPS: SettingsGroup[] = [
  {
    id: 'listen',
    label: '听歌',
    sections: [
      { id: 'playback', label: '播放与音质' },
      { id: 'recommend', label: '推荐来源' },
      { id: 'downloads', label: '下载' }
    ]
  },
  {
    id: 'look',
    label: '界面',
    sections: [
      { id: 'appearance', label: '外观与桌面' },
      { id: 'keys', label: '快捷键' }
    ]
  },
  {
    id: 'app',
    label: '应用',
    sections: [
      { id: 'system', label: '启动与系统' },
      { id: 'maintenance', label: '清理与维护' },
      { id: 'update', label: '更新与关于' }
    ]
  }
]

const SECTIONS = GROUPS.flatMap((group) => group.sections)

/**
 * 分段 → 面板。
 *
 * 用一张表而不是一长串三元：加一段要动的地方只有 GROUPS 和这里两处，
 * 也顺手把「哪个 id 忘了接面板」这种漏项变成类型能看出来的空位。
 */
type PageState = ReturnType<typeof useSettingsPage>
type PaneFactory = (page: PageState) => ReactNode

const PANES: Record<string, PaneFactory> = {
  playback: (page) => <PlaybackPane page={page} />,
  recommend: () => <RecommendPane />,
  downloads: () => <DownloadPane />,
  appearance: (page) => <AppearancePane page={page} />,
  system: (page) => <SystemPane page={page} />,
  keys: () => <HotkeysPane />,
  maintenance: (page) => <MaintenancePane page={page} />,
  update: (page) => <UpdatePane page={page} />
}

export function SettingsView() {
  // 只在这里读一次设置：useSettingsPage 是普通 hook（内部有 IPC 与订阅），
  // 每个分区各读一次会重复请求，也会让 busy/error 各说各的。
  const page = useSettingsPage()
  const [active, setActive] = useState(SECTIONS[0].id)
  const section = SECTIONS.find((item) => item.id === active) ?? SECTIONS[0]
  const render = PANES[section.id]

  return (
    <div className="settings">
      <div className="settings__tabs" aria-label="设置分区">
        {GROUPS.map((group) => (
          <div className="settings__tabgroup" key={group.id}>
            <span className="settings__tabgroup__title">{group.label}</span>
            {group.sections.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings__tab${active === item.id ? ' is-active' : ''}`}
                aria-current={active === item.id ? 'true' : undefined}
                onClick={() => setActive(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="settings__body">
        {page.error ? <p className="settings__error">{page.error}</p> : null}
        <Part zh={section.label} id={section.id}>
          {render ? render(page) : null}
        </Part>
      </div>
    </div>
  )
}
