import { useSettingsPage } from '../../features/settings/store'
import { Part } from './parts'
import { AppearancePane } from './panes/AppearancePane'
import { PlaybackPane } from './panes/PlaybackPane'
import { HotkeysPane } from './panes/HotkeysPane'
import { UpdatePane } from './panes/UpdatePane'
import './settings.css'

/**
 * 设置页。
 *
 * 这里只放偏好：怎么播、界面长什么样、键位是什么、以及版本与数据。
 * 「我是谁、登了哪些平台」不在这——它是账号页，入口是侧栏最底下那张头像，
 * 理由见 src/views/AccountView.tsx。
 *
 * 页面标题由外壳打印（见 docs/ui-design.md「一页一个标题」），这里只负责分区与行。
 * 分区顺序就是一个人排设置的顺序：怎么播、界面长什么样、键位是什么，
 * 最后是这个应用本身的版本、更新与数据。
 */
export function SettingsView() {
  // 只在这里读一次设置：useSettingsPage 是普通 hook（内部有 IPC 与订阅），
  // 每个分区各读一次会重复请求，也会让 busy/error 各说各的。
  const page = useSettingsPage()

  return (
    <div className="settings">
      {page.error ? <p className="settings__error">{page.error}</p> : null}

      <Part num="01" en="PLAYBACK & QUALITY" zh="播放与音质">
        <PlaybackPane page={page} />
      </Part>

      <Part num="02" en="APPEARANCE & DESKTOP" zh="外观与桌面">
        <AppearancePane page={page} />
      </Part>

      <Part num="03" en="KEYBOARD" zh="快捷键">
        <HotkeysPane />
      </Part>

      <Part num="04" en="UPDATE & ABOUT" zh="更新与关于">
        <UpdatePane page={page} />
      </Part>

    </div>
  )
}
