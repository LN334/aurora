import { bridge, isNative } from '../../bridge'
import type { NeteaseApi, NeteaseDiscoverKind, NeteaseDiscoverResult } from '../../env'

/**
 * The one way the online source is reached.
 *
 * Reading `window.aurora.netease` directly would work in Electron and crash the
 * browser preview, and the preview is how the interface gets reviewed without
 * launching the app. Going through the bridge's fallback keeps every call
 * answerable in both worlds: the fallback returns empty results and
 * "signed out" instead of throwing, so the view renders its real empty states
 * rather than an error boundary.
 */
export const netease: NeteaseApi = isNative
  ? (window.aurora?.netease ?? bridge.netease)
  : bridge.netease

/**
 * Whether the online source can actually reach an upstream server.
 *
 * False in the browser preview, where there is no main process to fetch with.
 * The interface uses this to say "this build has no online source" once, at the
 * top, instead of surfacing a network failure for every single action.
 */
export const hasNeteaseBackend = isNative && Boolean(window.aurora?.netease)

/**
 * 发现页一个板块的公开内容。
 *
 * 走 `discover` 而不是单列三个方法：三个板块的形状只差在「歌曲数组还是歌单
 * 数组」，用一个 kind 参数就能让 IPC 只多一个通道。没有主进程时（浏览器预览、
 * 旧构建）返回空结果——页面显示空态，不需要为「这个通道不存在」再写一条错误
 * 分支。
 */
export async function neteaseDiscover(
  kind: NeteaseDiscoverKind,
  limit?: number
): Promise<NeteaseDiscoverResult> {
  const discover = netease.discover
  if (!discover) return { kind, songs: [], playlists: [] }
  return discover.call(netease, kind, limit)
}

/** 这个构建有没有接上发现页的通道；页面用它区分「空」和「没接通」。 */
export function hasNeteaseDiscover(): boolean {
  return typeof netease.discover === 'function'
}

