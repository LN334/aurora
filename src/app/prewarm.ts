import { useDiscover } from '../features/discover/store'
import { loadPlatformDaily } from '../features/online/daily'
import { roamPlatforms } from '../features/player/roam-sources'

/**
 * 开屏期间先把几个页面的数据拉起来。
 *
 * 开屏本来就是一段不给看任何东西的等待。把它用来发请求，揭幕时首页与每日推荐
 * 已经有内容，切过去不用再看一遍骨架——「开场动画的时候其他页面也加载好」说的
 * 就是这件事。
 *
 * 只预热门槛明确的三块：
 * - 首页的推荐歌单与最近新歌（discover store 自己带 TTL 与单飞，重复调用不会多打）；
 * - 首页与每日推荐共用的那一批（按当前勾选的平台取，结果落进 daily 自己的模块缓存，
 *   页面挂载时直接命中）。
 *
 * 这几块之外的数据还在各自组件的 state 里，从外面拉不到；那些页面切过去仍是
 * 按需加载。要让它们也进预热，得先把取数搬进模块级缓存，不是这里加一行能解决的。
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
  return Promise.allSettled(jobs.map((job) => job.catch(() => undefined)))
}
