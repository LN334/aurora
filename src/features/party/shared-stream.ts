/**
 * 房主那份播放地址，在「收到房间消息」与「取流」之间传一下。
 *
 * 为什么要单独一个模块：播放内核的取流入口（player/pick）不能 import 一起听
 * 的 store——那会绕回玩家状态，形成环。这里只存一个值，两个方向都只 import
 * 它，谁也不碰谁的 store。
 *
 * 只记一首：换歌之后旧地址就没用了。
 */
interface SharedStream {
  trackId: string
  /**
   * 转发路径（`/stream/<令牌>`），只有路径没有主机。
   *
   * 主机由客人自己补——他连进来用的是哪个地址，就走哪个。房主填了公网地址时，
   * 同一 WiFi 的客人不该被绕到公网再回来一趟。
   */
  path?: string
  /** 房主没开公网入口时，直接把平台直链给出去。 */
  url?: string
  /** 顶部音质档的短名（母带 / 无损 / Hi-Res），用来告诉客人「这是谁的档」。 */
  quality: string
}

let shared: SharedStream | null = null
/** 客人连进房间用的地址；给相对路径拼主机用。 */
let origin = ''

export function rememberSharedStream(stream: SharedStream | null): void {
  shared = stream
}

export function rememberSharedOrigin(address: string): void {
  origin = address
}

/** 这首歌有没有房主给的那份流。trackId 对不上就是没有。 */
export function sharedStreamFor(trackId: string): SharedStream | null {
  if (!shared || shared.trackId !== trackId) return null
  return shared
}

/**
 * 把相对路径补成客人能直接请求的地址；没有路径时返回空串。
 *
 * origin 可能自带协议：客人用 `wss://` 连进来时（Cloudflare 隧道就是这么连的），
 * 直接拼 `http://` 会得到 `http://wss://…` 这种根本不存在的地址，音频静默失败。
 * 所以要先认出协议，再补对应的 http/https。
 */
export function resolveSharedUrl(stream: SharedStream): string {
  if (stream.url) return stream.url
  if (!stream.path || !origin) return ''
  const secure = /^wss:\/\//i.test(origin)
  const host = origin
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  return (secure ? 'https://' : 'http://') + host + stream.path
}
