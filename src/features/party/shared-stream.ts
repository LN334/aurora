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
  url: string
  /** 顶部音质档的短名（母带 / 无损 / Hi-Res），用来告诉客人「这是谁的档」。
   *  「档位」本身来自房主的设置，不是客人能改的东西。 */
  quality: string
}

let shared: SharedStream | null = null

export function rememberSharedStream(stream: SharedStream | null): void {
  shared = stream
}

/** 这首歌有没有房主给的那份流。trackId 对不上就是没有。 */
export function sharedStreamFor(trackId: string): SharedStream | null {
  if (!shared || shared.trackId !== trackId) return null
  return shared
}
