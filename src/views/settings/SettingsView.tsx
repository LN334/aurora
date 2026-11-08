import { useEffect, useState } from 'react'
import { useSettingsPage } from '../../features/settings/store'
import { Part } from './parts'
import { AppearancePane } from './panes/AppearancePane'
import { SystemPane } from './panes/SystemPane'
import { PlaybackPane } from './panes/PlaybackPane'
import { RecommendPane } from './panes/RecommendPane'
import { HotkeysPane } from './panes/HotkeysPane'
import { UpdatePane } from './panes/UpdatePane'
import { MaintenancePane } from './panes/MaintenancePane'
import './settings.css'

/**
 * 设置页。
 *
 * 版式：左边一列目录，右边一列内容。以前是长长一条从上滚到下，五块里想改
 * 「桌面歌词字号」得先滑过整页播放设置；目录把这一页变成可跳转的几段，
 * 也让「设置里到底有什么」一眼可见——这是这一页最该回答的问题。
 *
 * 这里只放偏好：怎么播、界面长什么样、键位是什么、以及版本与数据。
 * 「我是谁、登了哪些平台」不在这——它是账号页，入口是侧栏最底下那张头像，
 * 理由见 src/views/AccountView.tsx。
 */
const SECTIONS = [
  { id: 'playback', label: '播放与音质' },
  { id: 'recommend', label: '推荐来源' },
  { id: 'appearance', label: '外观与桌面' },
  { id: 'system', label: '启动与系统' },
  { id: 'keys', label: '快捷键' },
  { id: 'maintenance', label: '清理与维护' },
  { id: 'update', label: '更新与关于' }
] as const

export function SettingsView() {
  // 只在这里读一次设置：useSettingsPage 是普通 hook（内部有 IPC 与订阅），
  // 每个分区各读一次会重复请求，也会让 busy/error 各说各的。
  const page = useSettingsPage()
  const [active, setActive] = useState<string>(SECTIONS[0].id)

  /*
   * 高亮跟着滚动走，但不是「谁在视口里就选谁」——那样两个分区同时露头时会来回跳。
   * 观察器只负责报告每个分区的可见比例，真正决定的规则在下面：取最靠上的那个
   * 已经进入上半屏的分区。这样往下一格就是下一项，往上退回上一项。
   */
  useEffect(() => {
    const nodes = SECTIONS.map((section) => document.getElementById(`set-${section.id}`)).filter(
      (node): node is HTMLElement => node !== null
    )
    if (nodes.length === 0) return

    const visible = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace('set-', '')
          visible.set(id, entry.isIntersecting ? entry.intersectionRatio : 0)
        }
        const first = SECTIONS.map((section) => section.id).find((id) => (visible.get(id) ?? 0) > 0)
        if (first) setActive(first)
      },
      // 上边留一点余量，下边收窄：只有真正滚到眼前的分区才算「当前」。
      { rootMargin: '-8% 0px -55% 0px', threshold: [0, 0.2, 0.6] }
    )

    for (const node of nodes) observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const jump = (id: string) => {
    document.getElementById(`set-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div className="settings">
      <nav className="settings__nav" aria-label="设置目录">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`settings__nav-item${active === section.id ? ' is-active' : ''}`}
            aria-current={active === section.id ? 'true' : undefined}
            onClick={() => jump(section.id)}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <div className="settings__body">
        {page.error ? <p className="settings__error">{page.error}</p> : null}

        <Part zh="播放与音质" id="playback">
          <PlaybackPane page={page} />
        </Part>

        <Part zh="推荐来源" id="recommend">
          <RecommendPane />
        </Part>

        <Part zh="外观与桌面" id="appearance">
          <AppearancePane page={page} />
        </Part>

        <Part zh="启动与系统" id="system">
          <SystemPane page={page} />
        </Part>

        <Part zh="快捷键" id="keys">
          <HotkeysPane />
        </Part>

        <Part zh="清理与维护" id="maintenance">
          <MaintenancePane page={page} />
        </Part>

        <Part zh="更新与关于" id="update">
          <UpdatePane page={page} />
        </Part>
      </div>
    </div>
  )
}
