import { bridge } from '../bridge'
import { useDiscover } from '../features/discover/store'
import { loadPlatformDaily } from '../features/online/daily'
import { prewarmPlatformLiked } from '../features/online/platform-liked'
import { prewarmRecommendedAlbums } from '../features/online/recommended-albums'
import { prewarmRecommendedPlaylists } from '../features/online/recommended'
import { useOnlineStore } from '../features/online/store'
import { roamPlatforms } from '../features/player/roam-sources'

/**
 * 开屏期间先把几个页面的数据拉起来。
 *
 * 开屏本来就是一段不给看任何东西的等待。把它用来发请求，揭幕时首页与每日推荐
 * 已经有内容，切过去不用再看一遍骨架——「开场动画的时候其他页面也加载好」说的
 * 就是这件事。要问四家平台的那几块（我喜欢的、非勾选平台的账号歌单）挪到了揭幕
 * 之后，见 prewarmAfterSplash：它们不是首屏，先背那几百兆不值。
 *
 * 覆盖的四块，都是首屏与最近一次切换要画的：
 * - 首页的推荐歌单与最近新歌（discover store 自己带 TTL 与单飞）；
 * - 首页推荐歌单里 QQ 与汽水那两家（模块缓存，与页面同一判断）；
 * - 首页与每日推荐共用的那一批（按勾选的平台取，落进 daily 的模块缓存）；
 * - 首页「推荐专辑」那一排（三家平台各一次往返，结果进模块缓存）；
 * - 「歌单」页：对勾选的平台各跑一次 init——init 里就会拉这个账号的歌单，
 *   store 有在飞去重，与页面挂载时的 init 撞上也只跑一次。
 *
 * 还没覆盖的：各平台的详情页——那要打开才取，预热等于把整个曲库爬一遍。
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
  jobs.push(prewarmRecommendedAlbums())
  jobs.push(prewarmRecommendedPlaylists())
  jobs.push(prewarmAccounts(false))
  return Promise.allSettled(jobs.map((job) => job.catch(() => undefined)))
}

/**
 * 只 init「勾选着」的平台。
 *
 * 原来这里拉的是**所有已登录**的平台：四家都登着就是四家后端一起起来——网易云
 * 那一步 require 上游包（常驻 +93 MB）、酷狗 spawn 本地 Node 服务、QQ 读 SDK，
 * 而这些是开屏那三秒里发生的。四家的歌单页要等用户真切过去才看得到，先付这笔
 * 内存不划算：非勾选的那几家留给页面自己 init，那时才付出代价。
 */
async function prewarmAccounts(allSignedIn: boolean): Promise<void> {
  const map = await bridge.platforms.signedIn().catch(() => ({} as Record<string, boolean>))
  const signed = Object.keys(map).filter((id) => map[id])
  const chosen = roamPlatforms()
  const ids = allSignedIn ? signed : signed.filter((id) => chosen.includes(id as never))
  if (ids.length === 0) return
  await Promise.all(
    ids.map((id) =>
      useOnlineStore(id as never)
        .getState()
        .init()
        .catch(() => undefined)
    )
  )
}

/**
 * 揭幕之后接着做的预热。
 *
 * 这些都不是首屏要画的东西：「我喜欢的」要问四家平台的收藏，非勾选平台的账号
 * 歌单也要把它们后端拉起来。放在开屏里会让那三秒多背几百兆，放到揭幕后 1.8 秒
 * 再跑——用户点过去时多半已经好了，而开屏那段时间的内存峰值不带上它们。
 */
export function prewarmAfterSplash(): void {
  window.setTimeout(() => {
    void prewarmPlatformLiked()
    void prewarmAccounts(true)
  }, 1800)
}
