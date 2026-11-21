import { bridge } from '../bridge'
import { useDiscover } from '../features/discover/store'
import { loadPlatformDaily } from '../features/online/daily'
import { prewarmPlatformLiked } from '../features/online/platform-liked'
import { useOnlineStore } from '../features/online/store'
import { roamPlatforms } from '../features/player/roam-sources'

/**
 * 开屏期间先把几个页面的数据拉起来。
 *
 * 开屏本来就是一段不给看任何东西的等待。把它用来发请求，揭幕时首页、每日推荐、
 * 我喜欢的、歌单都已有内容，切过去不用再看一遍骨架——「开场动画的时候其他页面
 * 也加载好」说的就是这件事。
 *
 * 覆盖的四块，都是切过去最常见的目标：
 * - 首页的推荐歌单与最近新歌（discover store 自己带 TTL 与单飞）；
 * - 首页与每日推荐共用的那一批（按勾选的平台取，落进 daily 的模块缓存）；
 * - 「我喜欢的」的四家收藏（落进 platform-liked 的模块缓存）；
 * - 「歌单」页：对已登录的平台各跑一次 init——init 里就会拉这个账号的歌单，
 *   store 有在飞去重，与页面挂载时的 init 撞上也只跑一次。
 *
 * 还没覆盖的：推荐专辑（数据在组件 state 里）、各平台的详情页（打开才取，
 * 预热等于把整个曲库爬一遍）。那些页面切过去仍按需加载。
 *
 * 失败一律吞掉：预热不该把开屏卡到上限，页面自己的空态与重试仍在。
 */
export function prewarmPages(): Promise<unknown> {
  const jobs: Array<Promise<unknown>> = []
  const chosen = roamPlatforms()
  if (chosen.includes('netease')) {
    const state = useDiscover.getState()
    /*
     * 没勾网易云就别问「最近新歌」：这一问会把那 93 MB 的上游包拉进主进程，
     * 与 push-platforms 里那条判断是同一个原因。
     */
    jobs.push(state.load('playlists'), state.load('newsongs'))
  }
  if (chosen.length > 0) jobs.push(loadPlatformDaily(chosen))
  jobs.push(prewarmPlatformLiked())
  jobs.push(prewarmAccounts())
  return Promise.allSettled(jobs.map((job) => job.catch(() => undefined)))
}

/**
 * 歌单页预热：只对已登录的平台跑 init。
 *
 * 先问主进程「谁登录过」（只读会话文件，零加载），再只拉这几家——与页面里
 * `useAccountPlaylists` 同一条判断，不能对四家无条件 init：网易云那一步要
 * require 上游包，酷狗要 spawn 本地服务，为一张没登录的歌单页付这个代价不值。
 */
async function prewarmAccounts(): Promise<void> {
  const map = await bridge.platforms.signedIn().catch(() => ({} as Record<string, boolean>))
  const signed = Object.keys(map).filter((id) => map[id])
  await Promise.all(
    signed.map((id) =>
      useOnlineStore(id as never)
        .getState()
        .init()
        .catch(() => undefined)
    )
  )
}
