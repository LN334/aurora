import { isNative } from '../bridge'
import { readLastView, readStartupPage } from '../features/settings/startup-page'
import { MENU_TEST_MODE, PERF_MODE, SCROLL_TEST_MODE } from './preview'
import { routeToShell, shellFromHash, type ShellRoute } from './shell-pure'
import type { Route } from './routing'

/**
 * 外壳路由的入口层。
 *
 * 地址写法与两向翻译在 shell-pure.ts（纯函数，单测直接跑）；这里只剩「打开
 * 应用时落在哪一页」——它要读 localStorage、要认预览开关，在 node 里跑不起来。
 */
export * from './shell-pure'

/** 打开应用时落在哪一页。 */
export function initialShell(): ShellRoute {
  if (PERF_MODE) return { view: 'settings' }
  if (SCROLL_TEST_MODE) return { view: 'local' }
  if (MENU_TEST_MODE) return { view: 'local' }
  const parsed = shellFromHash(window.location.hash)
  if (parsed) return parsed
  // 启动页：设置里选的，或者「上次那页」（默认）。认不出来就回首页。
  const startup = readStartupPage()
  if (startup === 'last') {
    const last = readLastView()
    if (last) return { view: last }
  } else if (startup !== 'home') {
    return { view: startup }
  }
  // 打开就能听：推荐页未登录也有内容，曲库为空也不是一进来看空地。
  if (isNative) return { view: 'home' }
  // 旧书签（#songs / #collection 之类）仍然认，落到对应的新页面。
  return routeToShell(legacyRoute())
}

function legacyRoute(): Route {
  return { view: 'discover' }
}

