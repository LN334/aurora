import { useEffect, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { useSettingsPage } from '../../features/settings/store'
import { useUpdate } from '../../features/updates/store'
import {
  Album,
  Close,
  Compass,
  DesktopLyrics,
  Download,
  Folder,
  Library,
  List,
  Lyrics,
  Play,
  Refresh,
  Search,
  Settings,
  Sliders,
  Trash,
  User,
  Volume,
  Wave
} from '../../ui/icons'
import {
  SETTINGS_GROUPS,
  SETTINGS_PAGES,
  searchSettings,
  settingsPage
} from './schema'
import type { SettingsIcon, SettingsPageId, SettingsSearchHit } from './schema'
import { AppearancePane } from './panes/AppearancePane'
import { HomePane } from './panes/HomePane'
import { MotionPane } from './panes/MotionPane'
import { OverlayPane } from './panes/OverlayPane'
import { PlaybackPane } from './panes/PlaybackPane'
import { QualityPane } from './panes/QualityPane'
import { LyricsPane } from './panes/LyricsPane'
import { RecommendPane } from './panes/RecommendPane'
import { PartyPane } from './panes/PartyPane'
import { GeneralPane } from './panes/GeneralPane'
import { HotkeysPane } from './panes/HotkeysPane'
import { DownloadPane } from './panes/DownloadPane'
import { StoragePane } from './panes/StoragePane'
import { PlatformsPane } from './panes/PlatformsPane'
import { UpdatePane } from './panes/UpdatePane'
import { MaintenancePane } from './panes/MaintenancePane'
import { ResetPane } from './panes/ResetPane'
import './settings.css'

const ICONS: Record<SettingsIcon, ComponentType<{ size?: number }>> = {
  sliders: Sliders,
  library: Library,
  wave: Wave,
  desktopLyrics: DesktopLyrics,
  play: Play,
  volume: Volume,
  lyrics: Lyrics,
  compass: Compass,
  user: User,
  settings: Settings,
  list: List,
  download: Download,
  folder: Folder,
  album: Album,
  refresh: Refresh,
  trash: Trash
}

type PageState = ReturnType<typeof useSettingsPage>

/**
 * 二级页 → 内容。
 *
 * 一张表而不是一长串条件：加页时类型会要求这里补齐，忘了接面板编译就红。
 */
const PANES: Record<SettingsPageId, (page: PageState) => ReactNode> = {
  appearance: () => <AppearancePane />,
  home: () => <HomePane />,
  motion: () => <MotionPane />,
  overlay: (page) => <OverlayPane page={page} />,
  playback: () => <PlaybackPane />,
  quality: () => <QualityPane />,
  lyrics: (page) => <LyricsPane page={page} />,
  recommend: () => <RecommendPane />,
  party: () => <PartyPane />,
  general: (page) => <GeneralPane page={page} />,
  keys: () => <HotkeysPane />,
  downloads: (page) => <DownloadPane page={page} />,
  storage: (page) => <StoragePane page={page} />,
  platforms: () => <PlatformsPane />,
  update: (page) => <UpdatePane page={page} />,
  maintenance: (page) => <MaintenancePane page={page} />,
  reset: (page) => <ResetPane page={page} />
}

const ACTIVE_KEY = 'aurora.settings.page'

/** 记住上次看的二级页：从播放页进设置又回到「外观」很烦人。 */
function initialPage(): SettingsPageId {
  try {
    const saved = sessionStorage.getItem(ACTIVE_KEY)
    if (saved && SETTINGS_PAGES.some((page) => page.id === saved)) {
      return saved as SettingsPageId
    }
  } catch {
    // 隐私模式不给读，回默认页即可。
  }
  return 'appearance'
}

function rememberPage(id: SettingsPageId): void {
  try {
    sessionStorage.setItem(ACTIVE_KEY, id)
  } catch {
    // 记不住不影响这一程。
  }
}

interface Flash {
  key: string
  /** 同一个键连点两次也要能再滚一次，所以带个序号。 */
  n: number
}

/**
 * 设置页。
 *
 * 结构：左侧固定目录（搜索 + 一级分组 + 二级页），右侧独立滚动的正文。
 * 一级分组只在目录里出现，页标题上方再标一次组名——不然「通用」和「维护」
 * 谁是谁的上层，又得靠猜。
 *
 * 与主窗口左侧那条图标 Rail 的区别靠材质与位置做：这里是一条窄的实底侧栏，
 * 有搜索框、有分组标题、宽度只有 Rail 的两倍多，读起来是「面板里面的一层」，
 * 不是第二条主导航。
 */
export function SettingsPage() {
  const page = useSettingsPage()
  const updateReady = useUpdate((state) => state.result?.state === 'available' && !state.noted)
  const [active, setActive] = useState<SettingsPageId>(initialPage)
  const [query, setQuery] = useState('')
  const [flash, setFlash] = useState<Flash | null>(null)
  const def = settingsPage(active)
  const group = SETTINGS_GROUPS.find((item) => item.id === def.group)
  const hits = searchSettings(query)
  const render = PANES[active]

  useEffect(() => {
    rememberPage(active)
  }, [active])

  /*
   * 跳到命中行：等这一页渲染完再量位置。高亮用一次性的类，动画结束就摘掉，
   * 不留「永远是选中态」的假状态。
   */
  useEffect(() => {
    if (!flash) return
    const target = document.querySelector<HTMLElement>(`[data-set-key="${flash.key}"]`)
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.classList.add('is-flash')
    const timer = window.setTimeout(() => target.classList.remove('is-flash'), 1700)
    return () => {
      window.clearTimeout(timer)
      target.classList.remove('is-flash')
    }
  }, [flash, active])

  const jump = (hit: SettingsSearchHit): void => {
    setQuery('')
    setActive(hit.page)
    if (hit.key) setFlash({ key: hit.key, n: Date.now() })
    if (hit.page === 'update') useUpdate.getState().note()
  }

  return (
    <div className="settings">
      <aside className="settings__side">
        <div className="settings__search">
          <Search size={14} />
          <input
            value={query}
            placeholder="搜索设置"
            aria-label="搜索设置"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
              if (event.key === 'Enter' && hits[0]) jump(hits[0])
            }}
          />
          {query ? (
            <button
              className="settings__search-clear"
              type="button"
              aria-label="清空搜索"
              onClick={() => setQuery('')}
            >
              <Close size={12} />
            </button>
          ) : null}
        </div>

        {query ? (
          <div className="settings__results" role="list">
            {hits.length === 0 ? (
              <p className="settings__empty">没有匹配的设置。换个说法试试：字号、托盘、音质、缓存。</p>
            ) : (
              hits.map((hit) => (
                <button
                  key={hit.page + ':' + (hit.key ?? 'page')}
                  className="settings__result"
                  type="button"
                  role="listitem"
                  onClick={() => jump(hit)}
                >
                  <span className="settings__result-title">{hit.title}</span>
                  <span className="settings__result-path">{hit.context}</span>
                </button>
              ))
            )}
          </div>
        ) : (
          <nav className="settings__nav" aria-label="设置目录">
            {SETTINGS_GROUPS.map((item) => (
              <div className="settings__group" key={item.id}>
                <p className="settings__group-title">{item.label}</p>
                {item.pages.map((entry) => {
                  const Icon = ICONS[entry.icon]
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={'settings__nav-item' + (entry.id === active ? ' is-active' : '')}
                      data-page={entry.id}
                      aria-current={entry.id === active ? 'page' : undefined}
                      onClick={() => {
                        setActive(entry.id)
                        if (entry.id === 'update') useUpdate.getState().note()
                      }}
                    >
                      <Icon size={15} />
                      <span>{entry.label}</span>
                      {entry.id === 'update' && updateReady ? (
                        <span className="settings__nav-dot" aria-hidden="true" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        )}

        <p className="settings__side-foot">改动即时生效 · 自动保存</p>
      </aside>

      <div className="settings__scroll">
        <div className="settings__page">
          <header className="settings__head">
            <p className="settings__eyebrow">{group?.label ?? '设置'}</p>
            <h2 className="settings__title">{def.label}</h2>
            <p className="settings__blurb">{def.blurb}</p>
          </header>

          {page.error ? <p className="settings__error">{page.error}</p> : null}

          <div className="settings__cards">{render(page)}</div>
        </div>
      </div>
    </div>
  )
}
