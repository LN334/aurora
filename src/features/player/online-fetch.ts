import type { Track } from '../../types'

/**
 * 「这首歌的流还没有，去问平台要」——引擎与在线模块之间的唯一接口。
 *
 * 引擎必须能在切到队列下一首时补取流，但它不能 import 在线 store：那会把一整
 * 个平台客户端拉进播放内核，也会形成循环依赖。所以这里只放一个可替换的函数，
 * 在线模块启动时注册实现，引擎在缓存未命中时调用它。
 */

type Loader = (track: Track) => Promise<string | null>

let loader: Loader | null = null

export function setOnlineStreamLoader(fn: Loader | null): void {
  loader = fn
}

/** 取一首在线歌曲的播放地址；本机文件或不认识的平台一律返回 null。 */
export async function loadOnlineStream(track: Track): Promise<string | null> {
  if (!track.source || track.source === 'local') return null
  if (!loader) return null
  try {
    return await loader(track)
  } catch {
    /* 取流失败就是没取到：调用方会继续试下一个版本，不需要异常穿透。 */
    return null
  }
}
