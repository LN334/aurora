import { app, clipboard, ipcMain, shell } from 'electron'
import { chooseIcon, iconPreview, resetIcon } from '../app-icon'
import { mainWindowVisibility } from '../pure/scan-progress'
import { takeCrashReport } from '../crash-guard'
import { exportDiagnostics } from '../diagnostics'
import type { WindowSource } from './host'

/** Application facts, and whether the player window is on screen. */
export function registerAppIpc(deps: WindowSource): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    userData: app.getPath('userData')
  }))

  /*
   * Whether the player window is actually on screen. The renderer asks once at
   * startup and then follows `app:visibility`; see notifyVisibility() in main.ts.
   */
  ipcMain.handle('app:visibility', () => mainWindowVisibility(deps.window()))

  /*
   * 重启。
   *
   * 导入备份之后数据换了一份，进程里已经加载的偏好、曲库与缓存都还是旧的，
   * 只能重开。让用户自己关掉再开太麻烦，直接替他重启。
   */
  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.quit()
  })

  /*
   * 打开外部链接：只放行 GitHub 与樱花面板。
   *
   * 关于页的仓库与反馈按钮、以及一起听里「去注册樱花账号」走这里。渲染层永远
   * 拿不到 shell，白名单放在主进程，页面即使被注入脚本也打不开 file:// 或任意站点。
   */
  const EXTERNAL_ALLOWED = [/^https:\/\/github\.com\//, /^https:\/\/www\.natfrp\.com\//]
  ipcMain.handle('app:openExternal', (_event, url: unknown) => {
    if (typeof url !== 'string' || !EXTERNAL_ALLOWED.some((pattern) => pattern.test(url))) return false
    void shell.openExternal(url)
    return true
  })

  /*
   * 应用图标。读取只回一个预览，选择要开系统对话框，重置要动磁盘——三件事
   * 都只能由主进程做，所以都从这里过。
   */
  /*
   * 复制文本。
   *
   * 渲染层的 navigator.clipboard 在 aurora-app:// 下不是安全上下文，写剪贴板
   * 会直接失败——界面只能退回到「把地址显示出来让你自己抄」。主进程没有这个
   * 限制，所以复制一律走这里。
   */
  /*
   * 读剪贴板。
   *
   * 页面里 `navigator.clipboard` 在 aurora-app:// 下不是安全上下文，读和写都
   * 不work（写那边早就有 app:copy 绕过去了，读一直没人用）。调音台的「粘贴
   * 分享码」正是唯一要读的地方，这里补上同一条路。
   */
  ipcMain.handle('app:readClipboard', () => clipboard.readText())
  ipcMain.handle('app:copy', (_event, text: unknown) => {
    if (typeof text !== 'string' || !text) return false
    clipboard.writeText(text.slice(0, 8192))
    return true
  })

  /*
   * 导出诊断日志：用户在设置里点一下，选个位置存成一个 txt。
   *
   * 日志会脱敏（token / cookie / 房间令牌都替换掉）——这份文件是给外人看的，
   * 不能默认用户会自己检查一遍。取消保存返回空串。
   */
  ipcMain.handle('app:exportLogs', () => exportDiagnostics(deps.window()))
  /*
   * 上一次是不是异常退出。读完就清掉——提示只该出现一次，不然每次启动都像
   * 提醒用户「你的软件有问题」。
   */
  ipcMain.handle('app:crashReport', () => takeCrashReport())
  ipcMain.handle('app:icon:get', () => iconPreview())
  ipcMain.handle('app:icon:choose', () => chooseIcon())
  ipcMain.handle('app:icon:reset', () => resetIcon())
}