import type { OnlineMusicProvider, ProviderCapabilities } from './types.ts'

/**
 * 一个平台「能做什么」，只有一个真源。
 *
 * 从前有两张表在说同一件事：`capabilities` 里手写的布尔，和散在界面里的
 * `Boolean(provider.search)`、`provider.catalog?.album &&`。两张表迟早会不一致，
 * 而且已经不一致过——B 站声明了 `auth: true`，却从来没有 `auth` 通道，界面因此
 * 给了一个点不动的登录入口。
 *
 * 现在分成两个问题，各问各的：
 *
 *   - `implementsCapability`：结构事实。这个方法在这个对象上到底有没有。
 *   - `supportsCapability`：界面判据。声明可用 **且** 确实实现了。
 *
 * 只允许「实现了但暂不声明」（上游要 accesskey、暂时下线），不允许反过来：
 * 声明可用却没有实现，等于让界面给一个必然失败的入口。`brokenClaims` 专抓
 * 这一种，注册时就会在日志里报出来。
 */

/** 稳定的枚举顺序：界面按这个顺序枚举能力，不看对象字面量的书写顺序。 */
export const CAPABILITY_ORDER = [
  'search',
  'playback',
  'lyrics',
  'auth',
  'playlists',
  'albums',
  'artists',
  'recommendations',
  'userCloud',
  'likes',
  'comments',
  'commentSend',
  'commentLike'
] as const satisfies readonly (keyof ProviderCapabilities)[]

/** 能力与它落在哪个方法上的对应关系。加能力时只改这一处。 */
function implemented(provider: OnlineMusicProvider, capability: keyof ProviderCapabilities): boolean {
  const catalog = provider.catalog
  switch (capability) {
    case 'search':
      return Boolean(provider.search)
    case 'playback':
      return Boolean(provider.playback)
    case 'lyrics':
      return Boolean(provider.lyrics)
    case 'auth':
      return Boolean(provider.auth)
    case 'playlists':
      return Boolean(provider.playlists)
    case 'albums':
      return Boolean(catalog?.album)
    // 艺人页有两条通道：顶部概要（`artist`）和歌曲列表。任一条能取数就算这家
    // 有艺人页——只有 artistTopSongs 的平台仍能把页面画出来。
    case 'artists':
      return Boolean(catalog?.artist || catalog?.artistTopSongs)
    // 推荐与云盘共用一个容器，判据却要分开：云盘是「我自己存上去的」，
    // 有云盘不等于平台会给我推荐。三条推荐通道任一条在，就算有。
    case 'recommendations':
      return Boolean(
        provider.recommendations?.dailySongs ||
          provider.recommendations?.personalFm ||
          provider.recommendations?.likeList
      )
    case 'userCloud':
      return Boolean(provider.recommendations?.cloudSongs)
    case 'likes':
      return Boolean(provider.likes)
    // 评论三件事各判各的：能读不等于能发，能发不等于能赞。
    case 'comments':
      return Boolean(provider.comments?.list)
    case 'commentSend':
      return Boolean(provider.comments?.send)
    case 'commentLike':
      return Boolean(provider.comments?.like)
    default: {
      // 新增了 capability 却忘了在这里映射：类型上不可达，运行期留个可查的痕迹。
      const exhaustive: never = capability
      throw new Error(`capability not mapped: ${String(exhaustive)}`)
    }
  }
}

/** 结构事实：这个对象上真的有这条通道。 */
export function implementsCapability(
  provider: OnlineMusicProvider | null | undefined,
  capability: keyof ProviderCapabilities
): boolean {
  return provider ? implemented(provider, capability) : false
}

/**
 * 界面判据：能点。
 *
 * 声明与实现都为真才算数。缺一不可，因为两者各自会错：声明可能忘了改，
 * 实现可能因为上游限制被有意关掉。
 */
export function supportsCapability(
  provider: OnlineMusicProvider | null | undefined,
  capability: keyof ProviderCapabilities
): boolean {
  if (!provider) return false
  return Boolean(provider.capabilities[capability]) && implemented(provider, capability)
}

/** 声明可用、实际没有实现。应当永远为空；非空就是界面上的死入口。 */
export function brokenClaims(provider: OnlineMusicProvider): (keyof ProviderCapabilities)[] {
  return CAPABILITY_ORDER.filter(
    (capability) => provider.capabilities[capability] && !implemented(provider, capability)
  )
}

/**
 * 实现了、但没声明可用。
 *
 * 这不是错误，是有意的下线：酷狗的歌词要 accesskey，匿名拿不到，方法存在但
 * 界面不该给入口。登记在这里，是为了让「为什么这家没有这一项」有个可查的出处，
 * 而不是靠读代码猜。
 */
export function withheldCapabilities(provider: OnlineMusicProvider): (keyof ProviderCapabilities)[] {
  return CAPABILITY_ORDER.filter(
    (capability) => !provider.capabilities[capability] && implemented(provider, capability)
  )
}
