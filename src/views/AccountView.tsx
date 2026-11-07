import type { Route } from '../app/routing'
import { AccountPane } from './settings/panes/AccountPane'
import { PlatformLoginDialogs } from './settings/panes/PlatformSignIn'
// 分区排版（.set-part / .set-sub / .set-rows）与设置页共用同一份样式。
import './settings/settings.css'

/**
 * 账号页。
 *
 * 这一页原来在设置里当第一个分区（01 账号与平台）。但「我是谁、我登了哪些平台」
 * 不是一个偏好设置：它会随时被打开（换档案、扫码登录、退出账号），而且这些东西
 * 一旦改掉，整个曲库与在线内容都跟着换。放进设置里，每次都要先找到设置再往下滚。
 *
 * 所以它单独成页，入口是侧栏最底下那张头像——那里本来就写着当前是哪个档案，
 * 点进去就是这一页。设置页只留下真正的偏好项（播放、外观、快捷键、更新）。
 *
 * 账号里的音乐入口（每日推荐、我喜欢的音乐、云盘、我的歌单）不摆在这里：它们
 * 是内容，和「最近播放」一样属于主页。这一页只管登录状态；要看东西去主页的
 * 「我的音乐」。
 *
 * 页面标题由外壳打印（见 docs/ui-design.md「一页一个标题」），这里只负责内容。
 */
export function AccountView({ onNavigate }: { onNavigate(route: Route): void }) {
  return (
    <div className="account-page">
      <AccountPane onNavigate={onNavigate} />
      <PlatformLoginDialogs />
    </div>
  )
}
