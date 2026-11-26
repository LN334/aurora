import { isNative } from '../../bridge'

/**
 * Whether the online source can actually reach an upstream server.
 *
 * False in the browser preview, where there is no main process to fetch with.
 * The interface uses this to say "this build has no online source" once, at the
 * top, instead of surfacing a network failure for every single action.
 *
 * 2026-11-27：这个文件原来的 `netease` 与 `neteaseDiscover` 两个访问器已经搬进
 * 通道（`provider:call`），这里只剩「有没有主进程」这一句同步判断——它是唯一
 * 必须在模块求值期就知道答案的事实。
 */
export const hasNeteaseBackend = isNative && Boolean(window.aurora?.netease)
