import { cachedStreamUrl } from '../player/urls'
import { setOnlineStreamLoader } from '../player/online-fetch'
import { registerProviders } from './providers'
import { useOnlineStore } from './store'
import { cachedStream } from './streams'
import type { ProviderId } from './types'

/**
 * Registration, as a side effect.
 *
 * `providers.ts` owns the order; this module exists so the entry point can be one
 * plain `import './features/online/register'` with no call site to forget. Module
 * side effects are used deliberately sparingly in this app - `features/player/
 * actions` and `features/player/netease` are the other two - and the rule they
 * share is that the effect must be idempotent and must be the *only* way the
 * thing gets set up, so there is no ordering question for a reader to answer.
 */
registerProviders()

/*
 * 播放内核问「这首歌的流呢」时的答案。
 *
 * 缓存里有就直接给（点一首歌时 store 已经先取过一次，常见路径命中）；没有就
 * 用这个平台的 store 取一次再给。放在这里是刻意的：注册发生在应用启动时，
 * 一个 import 就够，没有调用顺序问题。
 */
setOnlineStreamLoader(async (track) => {
  const providerId = track.source as ProviderId | undefined
  const onlineId = track.onlineId
  if (!providerId || providerId === 'local' || onlineId === undefined) return null

  /*
   * 一律走 `aurora-cache:`，命中与否由主进程判断：命中是本地文件，未命中它会
   * 透传上游并顺手把整首存下来。这样播放内核不需要知道缓存的存在，也就不会
   * 出现「渲染层以为有缓存、主进程其实没有」的两套状态。
   */
  const key = `${providerId}:${onlineId}`
  const cached = cachedStream(providerId, onlineId)
  if (cached) return cachedStreamUrl(key, cached.url)

  await useOnlineStore(providerId).getState().ensureStream(onlineId)
  const resolved = cachedStream(providerId, onlineId)
  return resolved ? cachedStreamUrl(key, resolved.url) : null
})
