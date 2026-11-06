import { useSettingsPage } from '../../features/settings/store'
import { Part } from './parts'
import { AccountPane } from './panes/AccountPane'
import { AppearancePane } from './panes/AppearancePane'
import { PlaybackPane } from './panes/PlaybackPane'
import { PlatformLoginDialogs } from './panes/PlatformSignIn'
import { UpdatePane } from './panes/UpdatePane'
import './settings.css'

/**
 * 设置页。
 *
 * 以前这里是三个分开的导航项（档案 / 音源 / 偏好设置），各自一页、各有一半的答案：
 * 档案页管本地档案与每个档案绑的在线账号，音源页管能播什么与本地文件夹，设置页管
 * 播放、外观、更新与缓存。它们其实是同一件事的四段，所以合并成一页，按 01–04 编号分区。
 *
 * 页面标题由外壳打印（见 docs/ui-design.md「一页一个标题」），这里只负责分区与行。
 * 分区顺序就是一个人排设置的顺序：先是谁在用、能用哪些来源，再是怎么播、界面长什么样，
 * 最后是这个应用本身的版本、更新与数据。
 */
export function SettingsView() {
  // 只在这里读一次设置：useSettingsPage 是普通 hook（内部有 IPC 与订阅），
  // 每个分区各读一次会重复请求，也会让 busy/error 各说各的。
  const page = useSettingsPage()

  return (
    <div className="settings">
      {page.error ? <p className="settings__error">{page.error}</p> : null}

      <Part num="01" en="ACCOUNT & PROVIDERS" zh="账号与平台">
        <AccountPane />
      </Part>

      <Part num="02" en="PLAYBACK & QUALITY" zh="播放与音质">
        <PlaybackPane page={page} />
      </Part>

      <Part num="03" en="APPEARANCE & DESKTOP" zh="外观与桌面">
        <AppearancePane page={page} />
      </Part>

      <Part num="04" en="UPDATE & ABOUT" zh="更新与关于">
        <UpdatePane page={page} />
      </Part>

      <PlatformLoginDialogs />
    </div>
  )
}
