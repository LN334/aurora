import { create } from 'zustand'
import type { RepeatMode, Track } from '../../types'
import type { ProviderId } from '../online/types'
import { SLOTS } from '../online/slots'
import { trackKey } from '../online/unify'
import { onQueueReset, player } from './actions'
import {
  appendFresh,
  carryHeard,
  remainingSeconds,
  roamProgress,
  shouldPullMore,
  type RoamProgress,
  withoutTrack
} from './roam-pure'
import { buildRoamQueue, loadRoamPool, loadRoamQuick, loadRoamStream, loadSeedTracks } from './roam'
import { roamPlatforms } from './roam-sources'
import { listAvailableProviders } from '../online/registry'
import { useOnlineStore } from '../online/store'
import { readPushSignedOnly } from '../settings/push-signed'
import { usePlayer } from './store'

/**
 * 一趟漫游。
 *
 * 漫游不是一个页面，是一次播放会话：左栏点它就换掉队列开始放，播放页底下长出
 * 一条轨道。所以这一份状态必须活得比任何页面久，放在 store 里；页面组件只读它。
 *
 * 三条规矩先定下来，下面每一处都照着写：
 *
 * 1. 一直持续——快到这一趟的尾巴时就把下一批要过来接上，不等最后一首。
 * 2. 不重复——同一首在这一趟里只放一次；最近放过的也记着，下一趟尽量不再推。
 * 3. 不主动停止——循环是关的（循环会把放过的再放一遍，和上一条冲突），
 *    真到队列尽头只说明没要到新歌，过一会儿再要，而不是就此收工。
 *
 * 三样状态刻意分开：
 *
 * 1. `tracks` 是这一趟的全部候选，只增不减，除了被划掉的那首。
 * 2. 播放队列是 `tracks` 的一份拷贝（可能顺序不同、可能被别的操作插过歌）。
 *    两者用 `trackKey` 对上，不靠数组下标——下标会被 shuffle 和插队打乱。
 * 3. `heard` 记录这一趟里听过哪些。它不是播放历史，只服务「已听 6 / 20」这行字
 *    与「接着上次听」的落点。
 */

/** 划掉过的歌。会话结束后仍然不算漫游——同一个推荐反复出现正是漫游最烦的事。 */
const HIDE_KEY = 'aurora.roam.hidden'

/** 划掉列表的上限。推荐流是长期的，不封顶会一直长。 */
const HIDE_LIMIT = 300

/** 最近放过的歌，跨趟也记着。上限到了就滚掉最早的那几首，不是永远不再推。 */
const PLAYED_KEY = 'aurora.roam.played'
const PLAYED_LIMIT = 200

/**
 * 剩下几首时开始要下一批：留出提前量，免得等到最后一首才开始要、中间断一口气。
 *
 * 四首是按「一场大概五六分钟」估的：补批要几秒，切歌的人不会停在原地等它。
 */
const AHEAD = 4

/**
 * 还剩多少秒时开始要下一批。
 *
 * 首数是个不稳的尺子：6 首短歌二十分钟不到，6 首现场版能撑四十分钟。所以两条
 * 判据并行——首数先到就先补，剩余时长先到也先补；时长缺失时退回只看首数。
 */
const PULL_SECONDS = 900

function readKeys(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

function writeKeys(key: string, keys: Set<string>, limit: number): void {
  try {
    localStorage.setItem(key, JSON.stringify([...keys].slice(-limit)))
  } catch {
    // 存不进去就只在这次会话里有效，不该因此让漫游失败。
  }
}

/**
 * 要歌时要跳过哪些。
 *
 * 划掉的是长期的，最近放过的是滚动的：两者都算「这一首别再给我」。
 */
function browsedOut(): Set<string> {
  const out = readKeys(HIDE_KEY)
  for (const key of readKeys(PLAYED_KEY)) out.add(key)
  return out
}

interface RoamState {
  tracks: Track[]
  heard: Record<string, true>
  /** 正在向平台要第一趟。 */
  busy: boolean
  /** 正在往后接一批。 */
  pulling: boolean
  /** 要不到时的一句话，显示在左栏按钮下面。 */
  error: string
  /**
   * 这一趟没开起来，缺的是一个登录账号。
   *
   * 与 error 分开：error 是「试了但不行」的一句话，用一行提示就够了；没登录是
   * 「这条路要你先做一件事」，得摆一个能点的对话框，让人当场决定去不去登录。
   */
  needSignIn: boolean
  /**
   * 进这一趟时被换掉的循环模式。
   *
   * 漫游不重复，循环必须关掉；而播放页与底栏在漫游里都不给循环那颗键，所以
   * 不在这里换就没有别处能改。退出时还原。
   */
  parkedRepeat: RepeatMode | null
  /**
   * 刚被撤掉的那一首，只活三秒。
   *
   * 「不想再听」是一次不可见的写操作（进黑名单），划错了没有第二次机会，所以
   * 轨道上留一条能撤回的提示。同一次会话里只记最后一首。
   */
  dropped: DroppedTrack | null
  /**
   * 这一趟从哪首出发；null 就是没有种子。
   *
   * 种子只是「怎么排」的依据，不是「只能放像的」：排完照样取满几十首，种子自己
   * 排第一。收起那行字、退出漫游都回到 null。
   */
  seed: Track | null
}

/** 撤掉一首的两种意思：跳过这一次，还是以后都别再推。 */
type RoamDropReason = 'skip' | 'dislike'

interface DroppedTrack {
  track: Track
  reason: RoamDropReason
}

export const useRoam = create<RoamState>()(() => ({
  tracks: [],
  heard: {},
  busy: false,
  pulling: false,
  error: '',
  needSignIn: false,
  parkedRepeat: null,
  dropped: null,
  seed: null
}))

/**
 * 勾着的这几家里，有几家已经登录。
 *
 * 私人漫游与每日推荐都要账号；未登录时上游要么回空、要么回游客榜单（能看见、
 * 点了放不出来）。这个判断决定两件事：开趟前要不要直接劝登录、要不到歌时该给
 * 哪一句原因。
 *
 * 先 init 再数：没 init 过时 account 是空的，会把登录着的账号也当成没登录。
 * init 是单飞且幂等的，重复调用不额外发请求。
 */
async function signedCount(ids: ProviderId[]): Promise<number> {
  const wanted = new Set<string>(ids)
  const list = listAvailableProviders().filter((provider) => wanted.has(provider.id))
  await Promise.all(
    list.map((provider) => useOnlineStore(provider.id).getState().init().catch(() => {}))
  )
  return list.filter((provider) => Boolean(useOnlineStore(provider.id).getState().account)).length
}

/** 当前这首在不在这趟里。不在就不该显示漫游那套东西。 */
function isRoamTrack(track: Track | null): boolean {
  if (!track) return false
  const key = trackKey(track)
  return useRoam.getState().tracks.some((item) => trackKey(item) === key)
}

export function useRoamProgress(current: Track | null): RoamProgress {
  const tracks = useRoam((state) => state.tracks)
  const heard = useRoam((state) => state.heard)
  const keys = new Set(Object.keys(heard))
  return roamProgress(tracks, current, keys)
}

/**
 * 这一批补多少首：一趟的三分之一。
 *
 * 原先补一半（十首），一次要给平台翻好几轮，回得慢、也更容易一次塞进来一大截。
 * 少补一点、补得勤一点，接近原生客户端那条「切一首要几首」的流。
 */
const ROAM_MORE = Math.ceil(SLOTS.roam / 3)

/**
 * 把循环换成「关」，原模式记着等退出时还原。
 *
 * 两处要调：开新趟，以及回到一趟没结束的旧漫游。后者容易被漏掉——用户退出漫游后
 * 又手动开了列表循环，再点漫游，队列会从头绕回来，和「不重复」冲突。
 */
function parkRepeat(): void {
  const before = usePlayer.getState().repeat
  if (before === 'off') return
  if (!useRoam.getState().parkedRepeat) useRoam.setState({ parkedRepeat: before })
  usePlayer.getState().setRepeat('off')
}

/**
 * 漫游自己在换队列。
 *
 * 走的是同一个 player.playQueue（换队列只有这一个口子），但要先举一下旗，
 * 让「队列被替换就退出漫游」那条守卫让开——否则漫游刚装上的队列会把自己判成
 * 「用户去点别的了」，转头把自己清掉。
 */
let roamSwitch = false

/**
 * 这一趟的代号。开新趟、离开漫游、用户去听别的，都会 +1。
 *
 * 网络回来的两样东西——补出来的一批、刚开趟要的池子——都只是某个 await 之后的
 * setState，它们没有「用户已经走开」这个概念。实测的走法：漫游剩四首时按判据去
 * 要下一批，等它回来的这两三秒里点开一张专辑；队列换了、漫游也清了，那批歌随后
 * 落地，把 tracks 又填满——底栏重新写「漫游中」，还把漫游的歌接进那张专辑的队列。
 * 反过来也成立：刚点漫游、还在要快池时去点别的歌，一趟回来会把队列抢回去。
 *
 * 两种都是竞态，所以「有意复现不出现」。做法是每个 await 之后先核对代号，
 * 对不上就放手，一个字也不写进状态。
 */
let sessionEpoch = 0

/** 作废所有还在路上的请求。 */
function invalidateSession(): void {
  sessionEpoch += 1
}

function playRoamQueue(tracks: Track[], startAt: number): void {
  roamSwitch = true
  try {
    player.playQueue(tracks, startAt)
  } finally {
    roamSwitch = false
  }
}

/**
 * 把这一趟的队列装上并开播。
 *
 * 过滤全在这一处做，因为现在有两条来源：先到的快池、后来补齐的整池。两处各写一
 * 遍迟早会偏，而且「名单把池子吃空了就清一次滚动记录」这种兜底只需要一套。
 *
 * 种子是用户亲手挑的：哪怕它在「不想再听」名单里，这一趟也得放它。
 *
 * `epoch` 是调用方要歌之前记下的代号：等这批的这几秒里用户可能已经去听别的了，
 * 对不上就不要装——不然会把人家刚点开的歌单换掉。
 */
function commitRoam(queue: Track[], seed: Track | undefined, epoch: number): boolean {
  if (epoch !== sessionEpoch) return false
  const hidden = readKeys(HIDE_KEY)
  // 名单只读一次；以前放在 filter 回调里，每首歌都要读一遍 localStorage。
  const skip = browsedOut()
  const keep = seed ? trackKey(seed) : ''
  let tracks = queue.filter((track) => {
    const key = trackKey(track)
    return key === keep || !skip.has(key)
  })
  if (tracks.length === 0) {
    // 排除名单把池子吃空了。这是名单自己的问题：清掉滚动的部分再试一次，
    // 划掉的仍然排除。不清就会变成「漫游永远要不到歌」。
    writeKeys(PLAYED_KEY, new Set(), PLAYED_LIMIT)
    tracks = queue.filter((track) => trackKey(track) === keep || !hidden.has(trackKey(track)))
  }
  if (tracks.length === 0) return false
  // 这一趟正式开场：上一趟还在路上的一批就此作废（见 sessionEpoch 那段）。
  invalidateSession()
  // 漫游不重复：循环会让放过的再来一遍，先关掉，退出时还原。
  useRoam.setState({
    tracks,
    /*
     * 已听跟着人走，不跟着这批列表走：换池、补池、重开一趟都可能走到这里，
     * 一律清零会让轨道上那行字在听了七八首之后跳回 1。
     */
    heard: carryHeard(useRoam.getState().heard, tracks),
    seed: seed ?? null,
    busy: false,
    pulling: false,
    error: ''
  })
  parkRepeat()
  playRoamQueue(tracks, 0)
  return true
}

/**
 * 开趟时正在后台补池。
 *
 * 快池只有几首就开播了，补满这一趟要等网络。这段窗口里别让 refillIfLow 判「快见底」
 * ——它一判就会立刻再要一批，一趟于是变成两批（实测 3 首 + 补的 + 再要的 ≈ 38 首）。
 *
 * 记几个而不是一个布尔：补池是异步的，用户中途退出又重开一趟时，旧的那次回来会和
 * 新的一次叠着收尾。计数让「还有人没补完」这个判断不会被先回来的那个清掉。
 */
let filling = 0

/**
 * 开播之后在后台把整池补进来。
 *
 * 队列已经放起来了，这里只往后接：正在放的这首不动，用户不会因为等池子多等一秒。
 * 要不到就算了——补完之后会再看一眼剩多少，真不够再按正常判据要。
 */
async function fillRoamPool(wanted: ProviderId[]): Promise<void> {
  const epoch = sessionEpoch
  filling += 1
  try {
    const full = await loadRoamPool(wanted).catch(() => null)
    // 用户可能在这几百毫秒里退出了漫游（或者又开了一趟新的），这批就不是他的了。
    if (epoch !== sessionEpoch) return
    if (!full || full.freshTracks.length === 0) return
    const state = useRoam.getState()
    if (state.tracks.length === 0) return
    /*
     * 补的是「这一趟该有的那几十首」，不是整个池子。
     *
     * 池子有两份：tracks 是「推的 + 我喜欢的 + 本机 + 最近听过」并起来的一整池
     * （几百首，传它进来「我喜欢的」五百多首会一起落进队列，实测涨到 706）；
     * freshTracks 是其中平台推过来、我还没收藏的那部分——也不能整份倒进来，
     * 它跟着勾了几家、每家回多少走，实测能到一百三十多。这一趟的定长是
     * SLOTS.roam，buildRoamQueue 就是拿 freshTracks 洗一遍切这个数；这里跟着它，
     * 快池那几首之外再补十几首，一趟仍然是二十首。
     */
    const extra = appendFresh(state.tracks, buildRoamQueue(full), browsedOut())
    if (extra.length === 0) return
    useRoam.setState((prev) => ({ tracks: [...prev.tracks, ...extra] }))
    player.addToQueue(extra, 'end')
  } finally {
    filling -= 1
    // 补完再看一眼：池子今天回得少的话，这会儿按正常判据接着要。
    // 作废的那一次不查——那会儿放的是别人的队列。
    if (epoch === sessionEpoch) refillIfLow()
  }
}

/**
 * 开一趟的三种结果。
 *
 * 分「没要到」和「被打断」两种失败是必要的：前者该说一句话（点了没反应比报错更糟），
 * 后者恰恰**不该**说——用户早就点开别的歌了，两秒后弹一句「这一趟没要到歌」
 * 只会让人以为自己点错了什么。
 */
type RoamStart = 'ok' | 'failed' | 'cancelled'

/**
 * 点「漫游」。
 *
 * 有这一趟就接着听：先找第一首没听过的。没有就现要一趟。`ok` 表示队列已经换好，
 * 调用方可以进播放页；`failed` 表示这次没成，原因写在 error 里；`cancelled`
 * 表示等歌的这几秒里用户已经去听别的了，什么都不用说、也不该再动页面。
 *
 * 带一个种子进来是另一条路：「从这首出发」明确要换一趟，所以不接上一趟的账，
 * 而是把池子按与那首的亲疏重排，种子排第一。
 */
export async function startRoam(seed?: Track): Promise<RoamStart> {
  /*
   * 导航栏那颗「漫游」是 onClick={onRoam}，React 会把点击事件当第一个参数塞进来。
   * 加种子之前 startRoam 不收参数，所以没人发现；加了种子之后事件对象就成了
   * 「种子」，下面读 seed.artist.trim() 直接抛 TypeError。这里按「像不像一首歌」
   * 判一下，不像就当作没带种子。
   */
  const chosen = seed && typeof seed.artist === 'string' && typeof seed.title === 'string' ? seed : undefined
  const state = useRoam.getState()
  // 连点两下：手上这一趟已经在要了，第二下不该换来一句报错。
  if (state.busy) return 'cancelled'

  const current = usePlayer.getState().current()
  if (!chosen && state.tracks.length > 0) {
    // 这一趟还在：从第一首没听过的接着放。全都听过就从头，反正下面会补新的。
    if (current && isRoamTrack(current)) {
      parkRepeat()
      return 'ok'
    }
    const heard = state.heard
    const at = state.tracks.findIndex((track) => !heard[trackKey(track)])
    parkRepeat()
    playRoamQueue(state.tracks, at >= 0 ? at : 0)
    return 'ok'
  }

  /*
   * 从这里开始要网络，也就是从这里开始可能被用户打断：等歌的这几秒里他可能点开
   * 了一张专辑。记下代号，每个 await 之后核对一次；对不上就撒手——既不换队列，
   * 也不往状态里写一句话（那会儿界面上已经是别人的东西了）。
   */
  let epoch = sessionEpoch

  /*
   * 一家都没勾就别要了。这时上游一定回空，落到下面那句「这几家今天还没推过来，
   * 换几家或过会儿再试」——把人往「再等等」上引，而真正缺的是一个勾。
   * 推流平台只在设置里改，漫游轨上不再摆第二套开关。
   */
  const wanted = roamPlatforms()
  if (wanted.length === 0) {
    useRoam.setState({ busy: false, error: '设置 → 听歌 → 推荐来源里还没勾任何平台' })
    return 'failed'
  }
  /*
   * 勾着、但一家都没登录：先让人去登录，不要装作能推。
   *
   * 未登录时有的平台会回游客榜单：歌看得见，点开取流却回「需要登录」，这一趟
   * 就变成连续跳歌加一句报错。缺的是一次登录，不是一次重试。
   * 设置里关掉「只用我登录了的平台」的人例外：他明确接受公开榜单。
   */
  if (readPushSignedOnly() && (await signedCount(wanted)) === 0) {
    if (epoch !== sessionEpoch) return 'cancelled'
    useRoam.setState({ busy: false, error: '', needSignIn: true })
    return 'failed'
  }
  // 数登录的这几秒里用户可能已经点开别的歌了：那就当我没按过漫游。
  if (epoch !== sessionEpoch) return 'cancelled'

  /*
   * 真要开这一趟了：从这儿起算新的一趟，上一趟还在路上的东西一律作废。
   * 走到这里要么手上没有这一趟（tracks 为空），要么是种子模式明确要换一趟。
   */
  invalidateSession()
  epoch = sessionEpoch
  useRoam.setState({ busy: true, error: '' })
  try {
    /*
     * 先要一小批就能开播。
     *
     * 完整池要每家问三轮（私人漫游一次只回几首），四家就是十二次往返。原先这些
     * 全挡在「出声」前面：用户点完「漫游」之后要等池子攒齐才听到第一个音。快池
     * 每家只问一轮，够建一条队列就先放起来，剩下的在后面补。
     *
     * 种子模式不走这条：那一趟必须从这首出发，得等它自己的搜索结果。
     */
    if (!chosen) {
      const quick = await loadRoamQuick(wanted)
      // 等快池的这几秒里用户已经去听别的了：别把队列抢回来。
      if (epoch !== sessionEpoch) return 'cancelled'
      if (quick.length > 0) {
        /*
         * 先立「正在补池」再换队列。commitRoam 里的 playQueue 会同步触发订阅，
         * 那一刻队列只有快池那几首、看着就是「快见底」，不挡住它会立刻再要一批，
         * 一趟于是变成两批（实测 3 首 → 18 首 → 37 首）。
         *
         * 用引用计数而不是布尔：fillRoamPool 一进去就自己加一，这里退出去减一，
         * 补池还占着的时候计数仍然是 1。
         */
        filling += 1
        try {
          if (commitRoam(buildRoamQueue({ tracks: quick, freshTracks: quick }, SLOTS.roam), undefined, epoch)) {
            void fillRoamPool(wanted)
            return 'ok'
          }
        } finally {
          filling -= 1
        }
      }
      // 快池装不上、或者装的这会儿被用户打断：别再白跑一轮整池。
      if (epoch !== sessionEpoch) return 'cancelled'
    }
    // 种子模式，或者快池一首都没要到：退回攒齐的老路。
    // 种子模式要两路一起要：平台今天推的，和这个人的歌。
    const [pool, near] = await Promise.all([
      loadRoamPool(wanted),
      chosen ? loadSeedTracks(chosen, wanted) : Promise.resolve([] as Track[])
    ])
    // 攒整池要好几轮往返，中途被别的操作打断是常事。
    if (epoch !== sessionEpoch) return 'cancelled'
    /*
     * 同艺人的歌多半是用户手上已有的，严格说不算「新的」；但这一趟要的就是从这一
     * 首走进这个人的作品里，所以并进来一起排序。种子自己也在 near 里，建队列时去重。
     */
    const queue = buildRoamQueue(
      chosen ? { ...pool, freshTracks: [...near, ...pool.freshTracks] } : pool,
      SLOTS.roam,
      chosen
    )
    if (!commitRoam(queue, chosen, epoch)) {
      /*
       * 分两种原因：真没登录，还是今天真没推。
       *
       * 未登录时上游的私人漫游与每日推荐都回空，和「今天这批推完了」长得一模一样。
       * 这时劝「换几家或过会儿再试」是错的方向——缺的是一次登录。
       * 设置里关掉「只用我登录了的平台」的人例外：他接受公开榜单，那就是真没推。
       */
      const signed = !readPushSignedOnly() || (await signedCount(wanted)) > 0
      // 数登录的这几秒里也可能被用户走开：这句话就别写了。
      if (epoch !== sessionEpoch) return 'cancelled'
      useRoam.setState({
        busy: false,
        error: signed
          ? '这几家今天还没推过来，换几家或过会儿再试'
          : '这几家今天都没回歌，登录一下或过会儿再来'
      })
      return 'failed'
    }
    return 'ok'
  } catch (error) {
    // 打断之后的收尾不该留下报错：界面上已经换成别人的歌了。
    if (epoch !== sessionEpoch) return 'cancelled'
    const reason = error instanceof Error ? error.message : String(error)
    useRoam.setState({ busy: false, error: '这一趟没要到：' + (reason || '不知道哪儿出了岔子') })
    return 'failed'
  }
}

/**
 * 往后接一批。
 *
 * 列表与队列一起长：只长列表的话点尾巴卡会从头重放，只长队列的话轨道上看不到。
 * 正在放的这首不打断。要到的与手上的重复就说明平台今天翻到头了，记一句话，
 * 调用方自己决定过多久再试。
 */
async function pullRoamMore(): Promise<boolean> {
  const state = useRoam.getState()
  if (state.pulling) return false
  const wanted = roamPlatforms()
  if (wanted.length === 0) {
    useRoam.setState({ pulling: false, error: '设置 → 听歌 → 推荐来源里还没勾任何平台' })
    return false
  }
  // 这一批属于此刻的这一趟。回来时若对不上，说明用户已经走了（或又开了一趟）。
  const epoch = sessionEpoch
  useRoam.setState({ pulling: true, error: '' })
  let got = false
  try {
    const more = await loadRoamStream(ROAM_MORE, wanted)
    /*
     * 这一处是「漫游不肯退出」的老窝：等歌的那两三秒里用户点开一张专辑，
     * 队列换了、漫游也清了，这批随后落地把 tracks 重新填满——底栏又写「漫游中」，
     * 歌还被接进了那张专辑的队列。所以先核对代号，对不上就整批丢掉，一个字不写。
     */
    if (epoch !== sessionEpoch) return false
    const fresh = appendFresh(useRoam.getState().tracks, more, browsedOut())
    if (fresh.length === 0) {
      useRoam.setState({ pulling: false, error: '平台这批和手上重复了，过一会儿再要' })
    } else {
      useRoam.setState((prev) => ({ tracks: [...prev.tracks, ...fresh], pulling: false }))
      player.addToQueue(fresh, 'end')
      got = true
    }
  } catch (error) {
    if (epoch !== sessionEpoch) return false
    const reason = error instanceof Error ? error.message : String(error)
    useRoam.setState({ pulling: false, error: '这批没要到：' + reason })
  }
  if (got) {
    /*
     * 等这批的这几秒里用户可能又切掉好几首：十首还没落地就被吃掉一半。
     * 所以补完再看一眼，还缺就接着要——「一直切歌就一直加歌」靠的就是这一下。
     * 收敛得很快：每次至少补十首，而判据是剩六首，一轮就够；补不到时 got 为假，
     * 转去下面的重试，不会在这里空转。
     */
    if (wantsMore()) void pullRoamMore()
    return true
  }
  // 这一批没要到：断网、或平台今天翻到头。过一会儿再来，队列真走到尽头也由它接上。
  scheduleRetry()
  return false
}

let undoClock: ReturnType<typeof setTimeout> | null = null

/** 撤回提示活三秒：够看见、够点，但不至于在下一次换歌时还挂着。 */
const UNDO_MS = 3000

function clearUndoClock(): void {
  if (!undoClock) return
  clearTimeout(undoClock)
  undoClock = null
}

/**
 * 撤掉一首。
 *
 * 两种意思，用户分得清，代码也要分清：
 *
 * - `skip`：这一次不想听。从这一趟里拿掉就完了，不进黑名单——跳过不等于讨厌，
 *   把两者混成一个「划掉」，名单会越攒越大，最后推什么都不对。
 * - `dislike`：以后别再推。除了拿掉，还写进持久名单（上限 300 首）。
 *
 * 两种情况都做同一件事：从轨道和队列里一起摘掉。正在放的就是它，队列索引会落到
 * 后一首上，就地换歌——否则卡片没了歌还在响，看起来像没生效。
 */
export function hideRoamTrack(track: Track, reason: RoamDropReason = 'dislike'): void {
  if (reason === 'dislike') {
    const hidden = readKeys(HIDE_KEY)
    hidden.add(trackKey(track))
    writeKeys(HIDE_KEY, hidden, HIDE_LIMIT)
  }
  useRoam.setState((prev) => ({ tracks: withoutTrack(prev.tracks, track) }))
  // 队列里也摘掉：只从轨道上拿走的话，放到它时还会响，看起来像划掉没生效。
  const at = usePlayer.getState().queue.findIndex((item) => trackKey(item) === trackKey(track))
  if (at >= 0) player.removeFromQueue(at)

  clearUndoClock()
  useRoam.setState({ dropped: { track, reason } })
  undoClock = setTimeout(() => {
    undoClock = null
    if (useRoam.getState().dropped?.track === track) useRoam.setState({ dropped: null })
  }, UNDO_MS)
}

/**
 * 撤回上一次撤掉的那首。
 *
 * 名单里删掉（如果是「不想再听」），轨道末尾放回去，队列末尾也补一份——队列里
 * 那一份刚被摘掉了，不补回来会出现「列表里有、放到这首时跳过」的怪状态。
 * 放末尾而不是原位：这排是候选，不是一条有承诺的顺序，插回中间会把正在看的位置顶开。
 */
export function undoDrop(): void {
  const dropped = useRoam.getState().dropped
  if (!dropped) return
  clearUndoClock()
  const { track, reason } = dropped
  const key = trackKey(track)
  if (reason === 'dislike') {
    const hidden = readKeys(HIDE_KEY)
    if (hidden.delete(key)) writeKeys(HIDE_KEY, hidden, HIDE_LIMIT)
  }
  useRoam.setState((prev) => ({
    tracks: prev.tracks.some((item) => trackKey(item) === key) ? prev.tracks : [...prev.tracks, track],
    dropped: null
  }))
  player.addToQueue([track], 'end')
}

/**
 * 切歌时记一笔。
 *
 * 记「已听」是给轨道上那行字，记「放过」是给下一趟去重——两个都只该在切歌时写，
 * 所以由下面的订阅统一调用，不在组件里到处埋。
 */
function markRoamHeard(track: Track | null): void {
  if (!track) return
  const key = trackKey(track)
  if (!isRoamTrack(track)) return
  const { heard } = useRoam.getState()
  if (!heard[key]) useRoam.setState((prev) => ({ heard: { ...prev.heard, [key]: true } }))
  const played = readKeys(PLAYED_KEY)
  if (played.has(key)) return
  played.add(key)
  writeKeys(PLAYED_KEY, played, PLAYED_LIMIT)
}

/**
 * 收起「从〈某首〉出发」那行字。
 *
 * 只摘标记，不动已经排好的队列：点 × 的多半是嫌那行字占地方，不是要把这一趟
 * 重排一遍。下一趟从漫游按钮进来就是纯随机。
 */
export function dropSeed(): void {
  if (!useRoam.getState().seed) return
  useRoam.setState({ seed: null })
}

/** 退出漫游：轨道收起来。队列不换，正在放的继续放；被换掉的循环模式放回去。 */
export function endRoam(): void {
  clearUndoClock()
  // 还在路上的那批（补池、开趟要的快池）就此作废，回来时不会再把这一趟装回去。
  invalidateSession()
  const { parkedRepeat } = useRoam.getState()
  if (parkedRepeat) usePlayer.getState().setRepeat(parkedRepeat)
  useRoam.setState({
    tracks: [],
    heard: {},
    error: '',
    parkedRepeat: null,
    dropped: null,
    seed: null,
    // 这两个标志得一起收：作废的那一批不会再回来替自己收尾。
    busy: false,
    pulling: false
  })
}

let retry: ReturnType<typeof setTimeout> | null = null

/**
 * 队列快见底了就再要一批。
 *
 * 这里只判「该不该要」；要完之后的事（还不够就接着补、补不到就稍后重试）交给
 * pullRoamMore——两处补池（切歌时、补完复查时）因此走的是同一条路。
 */
function refillIfLow(): void {
  const roam = useRoam.getState()
  if (roam.tracks.length === 0) return
  // 正在要的时候又被切了一首：那一批回来时会自己复查，不必叠着发两批。
  if (roam.pulling) return
  if (!wantsMore()) return
  void pullRoamMore()
}

/** 还缺吗。首数到了就缺；首数没到但剩下的时长不够了（长曲之后常发生）也算缺。 */
function wantsMore(): boolean {
  // 开趟那几秒由 fillRoamPool 负责补满，这时判「快见底」只会把一趟叠成两批。
  if (filling > 0) return false
  const now = usePlayer.getState()
  const current = now.current()
  if (!current || !isRoamTrack(current)) return false
  const left = now.queue.length - now.index - 1
  // 时长为 0 表示这一批都没给时长，这时只用首数判据，免得每切一首都要一次网络。
  const leftSec = remainingSeconds(now.queue, now.index)
  return shouldPullMore(left, AHEAD) || (leftSec > 0 && leftSec < PULL_SECONDS)
}

/** 没要到就隔八秒再来。队列真走到尽头也由这里接着，漫游不主动停止。 */
function scheduleRetry(): void {
  if (retry) return
  retry = setTimeout(() => {
    retry = null
    refillIfLow()
  }, 8000)
}

/**
 * 用户去听别的东西了：漫游结束。
 *
 * 判据只有一条——整条队列被换掉，而换的人不是漫游自己。循环模式在这里还原，
 * 播放条与队列面板的漫游字样也跟着消失（它们读的是 useRoam.tracks）。
 */
onQueueReset(() => {
  if (roamSwitch) return
  /*
   * 不管手上有没有这一趟，先作废在路上的请求。「用户换了一条队列」这个动作本身
   * 就说明：刚才还在等的那些歌不用来了。少了这一句，点漫游之后那几百毫秒里点开
   * 一张专辑，要歌的请求回来会把整条队列换成漫游——看起来就是漫游赖着不走。
   */
  invalidateSession()
  const roam = useRoam.getState()
  if (roam.tracks.length === 0) {
    if (roam.busy || roam.pulling) useRoam.setState({ busy: false, pulling: false })
    return
  }
  endRoam()
})

/**
 * 切歌就记一笔，顺便看一眼要不要补。
 *
 * 订阅放在模块里而不是播放页里：用户离开播放页、在首页听歌时，这一趟也要接着长。
 */
usePlayer.subscribe((state, prev) => {
  if (state.index === prev.index && state.queue === prev.queue) return
  markRoamHeard(state.current())
  refillIfLow()
})
