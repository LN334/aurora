import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ShellRoute } from '../app/shell'
import { useDiscover } from '../features/discover/store'
import { useTasteProfile } from '../features/library/taste-hooks'
import { likedTracks, useFavorites } from '../features/favorites/store'
import { coverFor } from '../features/library/cover'
import { artThumbFor, artworkFor } from '../features/library/source'
import { useLibrary } from '../features/library/store'
import { toTrack } from '../features/netease/track'
import { player } from '../features/player/actions'
import { useRecentEntries, useToday } from '../features/player/history-store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { usePlayer } from '../features/player/store'
import { openOnlineAlbum, openOnlinePlaylist } from '../features/refs/navigate'
import { ArtistById, ArtistName } from '../ui/NameRef'
import { DiscWall } from '../features/discover/DiscWall'
import { useHomeSections } from '../features/settings/home-sections'
import { dailyBatch, usePlatformDaily } from '../features/online/daily'
import { usePlatformNewSongs } from '../features/online/news'
import { usePlatformLiked } from '../features/online/platform-liked'
import { useCollectedAlbums } from '../features/online/platform-collections'
import { collectedOnly, useAccountPlaylists } from '../features/online/playlist-cards'
import { picksByProvider, useRecommendedPlaylists } from '../features/online/recommended'
import { SLOTS } from '../features/online/slots'
import { useRecommendedAlbums } from '../features/online/recommended-albums'
import { mergeVersions } from '../features/online/unify'
import { useSourceOrder } from '../features/settings/source-order'
import type { Track } from '../types'
import { Artwork } from '../ui/Artwork'
import { SkeletonAlbums, SkeletonCards, SkeletonFresh } from '../ui/Skeleton'
import { formatSpan, formatTime } from '../ui/format'
import { ChevronLeft, ChevronRight, Folder, Heart, List, Note, Pause, Play } from '../ui/icons'

/**
 * 推荐页。
 *
 * 这一页的主角是「有什么可以听」，不是「你刚听过什么」。所以从上到下是：
 * 问候 → 正在播放（只有真在播时才存在，横着一条，不占主位）→ 平台推荐歌单 →
 * 我自己的四个入口 → 新歌 → 最近听过。
 *
 * 早前一版把「上次听到」做成一张大卡放在最上面，结果主页看起来像一个回放页：
 * 屏幕最贵的位置给了昨天听过的那一首，真正的推荐被挤到折叠线以下。
 *
 * 页标题由外壳打（左栏点亮的「推荐」），这里从二级信息起，不再出现第二个
 * 「推荐」。平台没有独立卡片位：网易云与 QQ 是来源，内容以推荐的形式出现。
 */

/** 多久以前：这一排写相对时间，比印绝对时刻更像「最近」。 */
function sinceLabel(at: number): string {
  if (!at) return ''
  const diff = Date.now() - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前'
  return Math.floor(diff / 86_400_000) + ' 天前'
}

function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const SOURCE_NAMES: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
  kugou: '酷狗',
  qishui: '汽水'
}

function sourceName(track: Track | null): string {
  if (!track) return '本机'
  return track.source ? (SOURCE_NAMES[track.source] ?? track.source) : '本机'
}

/**
 * 缺封面时的底色。
 *
 * 线上曲目没图是常态（下架、接口不给、历史里那首歌已经掉出榜单），一律画成
 * 同一个深色方块会让整页看起来像图片加载失败。按 id 取一个低饱和的双色渐变：
 * 每张都不一样，但都压在这个界面的冷色域里，壁纸仍然透得过来。
 */
function tintOf(seed: string): CSSProperties {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    background: `linear-gradient(150deg, hsl(${hue} 32% 28% / 0.26), hsl(${(hue + 42) % 360} 28% 14% / 0.34))`
  }
}

/**
 * 快捷卡上的缩略图。
 *
 * 走主进程代理：页面 CSP 不允许外域图片，原始地址由 aurora-remote:// 转发。
 * 没封面时返回 null，卡片退回图标——不留一个空方块。
 */
const REMOTE_IMAGE = 'aurora-remote://image/'

/** 封面墙要的是能拼进 background 简写的那个值，不是 React 的样式对象。 */
function tintCss(seed: string): string {
  return (tintOf(seed).background as string | undefined) ?? 'transparent'
}
function thumbOf(track: Track | null | undefined, px = 120): string | null {
  if (!track) return null
  const art = artworkFor(track)
  if (!art) return null
  /*
   * 在线曲目的 artworkFor 给的已经是包装过的 aurora-remote:// 地址。
   * 再包一层就变成 aurora-remote://image/aurora-remote%3A%2F%2F…，
   * 代理解一层拿到的仍是自定义协议，直接拒绝——渲染出来就是碎图。
   * 所以先剥掉那层壳，取回原始地址再按尺寸重包。
   */
  const upstream = art.startsWith(REMOTE_IMAGE) ? decodeURIComponent(art.slice(REMOTE_IMAGE.length)) : art
  /*
   * 本机曲目的封面本身就是 aurora-media://（扫描时从文件里抠出来的封面）。
   * 主进程那个代理只转 http(s)，把自定义协议递进去只能换回 400，图也出不来，
   * 所以本地地址原样交给页面——CSP 允许 aurora-media:。
   */
  if (!/^https?:/i.test(upstream)) return upstream
  return remoteImageUrl(sizedImage(upstream, px), px)
}

/** 一排卡最多几张。宽窗口一行放得下六张，再多就要横向滚了。 */
const ROW = 8

/**
 * 卡片副标题：先报首数，没有首数就报它从哪来。
 *
 * 酷狗的公开榜单不给曲目总数，接口里就是 0。直接写「0 首」比不写更糟——
 * 看起来像一张空单子。
 */

interface HomeViewProps {
  onNavigate(route: ShellRoute): void
}

export function HomePage({ onNavigate }: HomeViewProps) {
  const homeSections = useHomeSections()

  /* 四块全关时首页只剩每日推荐与快捷卡，得说一句，不然像是坏了。 */
  const allHidden =
    !homeSections.playlists && !homeSections.albums && !homeSections.fresh && !homeSections.recent
  const queue = usePlayer((state) => state.queue)
  const index = usePlayer((state) => state.index)
  const playing = usePlayer((state) => state.playing)

  const liked = useFavorites((state) => state.liked)
  const tracks = useLibrary((state) => state.tracks)

  const recent = useRecentEntries()
  const today = useToday()

  /*
   * 收藏：本机心标 + 各平台账号里的「我喜欢的」。
   *
   * 首页这一格以前只数本机收藏，于是左边栏点进「我喜欢的音乐」有 626 首，
   * 首页却写 0 首——同一件事两个数，谁都不敢信。
   */
  const { tracks: platformLiked } = usePlatformLiked()
  const { cards: accountCards } = useAccountPlaylists()
  const collectedPlaylists = useMemo(() => collectedOnly(accountCards), [accountCards])
  const collectedAlbums = useCollectedAlbums()

  /* 歌单那一格的封面：随便挑一张平台歌单，比本机凑出来的渐变更像个入口。 */
  const mineArt = useMemo(() => {
    const first = accountCards.find((card) => Boolean(card.coverUrl))
    return first?.coverUrl ? remoteImageUrl(sizedImage(first.coverUrl, 120), 120) : null
  }, [accountCards])

  /* 收藏格的缩略图：先看收藏歌单，没有再退到收藏专辑。 */
  const collectionArt = useMemo(() => {
    const first = collectedPlaylists[0] ?? collectedAlbums[0]
    if (!first?.coverUrl) return null
    return remoteImageUrl(sizedImage(first.coverUrl, 120), 120)
  }, [collectedPlaylists, collectedAlbums])

  const newBlock = useDiscover((state) => state.blocks.newsongs)

  /**
   * 歌单这一栏取的是「平台推荐了什么」，不是「我收藏了什么」。
   *
   * 之前拿各平台的我的歌单来填，首屏就出现了自己的「我喜欢的音乐」和自建
   * 歌单——推荐位放自己的收藏，等于把音乐库又摆了一遍。
   */
  const { rows: recommended, ready: playlistsReady } = useRecommendedPlaylists()
  const [batch, setBatch] = useState(0)
  /** 最近新歌：freshTick 驱动重取，freshBatch 驱动换一行看。 */
  const [freshTick, setFreshTick] = useState(0)
  const [freshBatch, setFreshBatch] = useState(0)
  /* 鼠标停在哪一行，左边的大卡就换哪一首；移出去回到第一首。 */
  const [freshLead, setFreshLead] = useState(0)
  const freshList = useRef<HTMLDivElement | null>(null)
  /**
   * 每平台各出 3 张，交错排。
   *
   * 之前是把两家的歌单倒在一起洗，池子大的那家占满整行 —— 用户看到的是「怎么
   * 全是酷狗」。数量按平台限定之后，「换一批」只在各家内部换。
   */
  const { picks } = useMemo(() => picksByProvider(recommended, batch, SLOTS.playlist), [recommended, batch])
  /** 推荐专辑：跟歌单一样有「换一批」，换的是平台那边的下一屏，不是本页重排。 */
  const [albumBatch, setAlbumBatch] = useState(0)
  const { rows: albumPicks, ready: albumsReady } = useRecommendedAlbums(SLOTS.album, albumBatch)
  const albumStrip = useRef<HTMLDivElement | null>(null)
  /*
   * 一排横条放得下一屏，剩下的横着藏。翻的是一屏（减去一点，让上一屏最后一张
   * 留个边、看得出「后面还有」），不是一张一张挪——那要按十几次。
   */
  function slideAlbums(direction: 1 | -1): void {
    const strip = albumStrip.current
    if (!strip) return
    strip.scrollBy({ left: direction * strip.clientWidth * 0.9, behavior: 'smooth' })
  }
  /**
   * 这一批专辑到底来自哪几家。
   *
   * 头部那行小字就报它：三家都在就别让用户以为只有网易云——之前那排先画网易云、
   * 后补另外两家，看起来正是「来源单一」。
   */
  const albumSources = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const row of albumPicks) {
      for (const on of row.platforms) {
        if (seen.has(on.providerId)) continue
        seen.add(on.providerId)
        out.push(on.providerLabel.replace(/\s*音乐$/, ''))
      }
    }
    return out
  }, [albumPicks])

  /*
   * 两排一起等，一起画。
   *
   * 推荐歌单是四家谁先回谁先长，推荐专辑是三家 Promise.all 一次落地——本来就
   * 不同步，于是首页先长出一排歌单，专辑再补上来。现在两块都等到位才放行，
   * 中间只留占位格，用户看到的是「一次出来」，而不是「一张一张填」。
   */
  const cardsReady = playlistsReady && albumsReady

  useEffect(() => {
    // 失败就整块不出现，不在首屏留一行报错——曲库里的东西够填满这一页了。
    void useDiscover.getState().load('newsongs').catch(() => {})
  }, [])

  const current = index >= 0 ? (queue[index] ?? null) : null

  /**
   * 没有在播的时候，这条横带退成「上次听到」，不是整块消失。
   *
   * 首页最上面那一行是播放器的行车记录仪：打开就知道刚才听到哪、能接着听。
   * 空着的时候留一整条空白反而让上面看起来没做完。
   */
  const lastPlayed = useMemo(() => {
    for (const entry of recent) if (entry.track) return entry.track
    return null
  }, [recent])
  const focus = current ?? lastPlayed
  const focusArt = focus ? artworkFor(focus) : null
  const isPlayingFocus = Boolean(current)

  const likedIds = useMemo(() => new Set(liked.map((entry) => entry.id)), [liked])
  const focusLiked = focus ? likedIds.has(focus.id) : false

  const recentAll = useMemo(() => {
    const out: Track[] = []
    for (const entry of recent) if (entry.track) out.push(entry.track)
    return out
  }, [recent])

  const recentTracks = useMemo(() => {
    const out: Track[] = []
    for (const entry of recent) {
      if (entry.track) out.push(entry.track)
      if (out.length >= ROW) break
    }
    return out
  }, [recent])

  /* 这一排写「多久以前听的」，比只印歌名更像一条时间线。 */
  const recentAt = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of recent) if (entry.track) map.set(entry.track.id, entry.at)
    return map
  }, [recent])

  const order = useSourceOrder()

  /* 同一首在两个平台都有时并成一行，计数与列表页对得上。 */
  const likedAll = useMemo(
    () => mergeVersions([...likedTracks(liked), ...platformLiked], order),
    [liked, platformLiked, order]
  )

  const { tracks: platformDaily, ready: platformDailyReady } = usePlatformDaily()
  // 口味画像只改排序：常听的人和他常去的平台排前面。
  const taste = useTasteProfile()

  /**
   * 今天听什么。
   *
   * 别人的主页第一屏几乎都是这个东西：一个「今天不用想，点开就有」的入口。
   * 平台推的按来源轮转着填满槽位，剩下的位置由本机曲库按口味补——条数由
   * SLOTS.daily 定死，关掉一家平台只换「谁填」，不会让这一块短一截。
   */
  const daily = useMemo(() => {
    // 本机一首都没有时退到最近播放：对在线用户来说那也是「我的歌」。
    const base = tracks.length > 0 ? tracks : recentAll
    return dailyBatch(platformDaily, base, new Date(), SLOTS.daily, taste)
  }, [tracks, recentAll, platformDaily, taste])

  /**
   * 右角那面封面墙要摊开的封面：今天这三十首全部。
   *
   * 墙会循环，所以张数就是「今天能听多少」——三十首一圈转回来。没有封面的
   * 那张画的是生成式占位图，看起来像「图片一直在加载」，所以把有封面的排前面；
   * 反正取模循环，顺序只影响先看到谁，不影响能翻到谁。
   */
  const dailyArt = useMemo(() => {
    const withArt = daily.filter((track) => Boolean(thumbOf(track, 200)))
    const without = daily.filter((track) => !thumbOf(track, 200))
    return [...withArt, ...without]
  }, [daily])

  /**
   * 一批十二张，正好两行六列。
   *
   * 一屏只给六张太薄：四家轮一遍就没了，看起来像只接了一两家。两行铺满之后
   * 每一家在首屏都能出三张，「换一批」再往后挪一屏。
   */
  /**
   * 新歌不再只有网易云一家。
   *
   * 网易云那份来自发现页的缓存，QQ 与酷狗从各自的新歌榜现取（都不需要登录）；
   * 三家合成之后同一个歌名只会占一行，平台徽章并排，点播放仍按音源优先级选。
   * 一次要六十首/家：池子得够一屏四十首，「换一批」才有地方可换。
   */
  const platformFresh = usePlatformNewSongs(60, freshTick)

  /**
   * 按源轮转的全序。
   *
   * 直接按优先级排会变成「网易云前十首」，另外两家永远进不了首屏——那和只接
   * 一家看起来没有区别。所以先交错成一条长队，再切成六行一屏。
   */
  const freshOrder = useMemo(() => {
    const base = newBlock.songs.map((song) => toTrack(song))
    const merged = mergeVersions([...base, ...platformFresh], order)

    const buckets = new Map<string, Track[]>()
    for (const track of merged) {
      const key = track.source ?? 'local'
      const bucket = buckets.get(key)
      if (bucket) bucket.push(track)
      else buckets.set(key, [track])
    }

    const out: Track[] = []
    for (let at = 0; at < 60; at += 1) {
      let added = false
      for (const bucket of buckets.values()) {
        const next = bucket[at]
        if (next) {
          out.push(next)
          added = true
        }
      }
      if (!added) break
    }
    return out
  }, [newBlock.songs, platformFresh, order])

  /**
   * 一屏四十首，换一批往后挪四十格，到底回到开头。
   *
   * 只挪切片不重取的话，平台第二次给的还是同一份榜单，用户会看到同一批歌；
   * 所以按钮同时把 freshTick 加一，让 QQ 与酷狗那边也重新问一次。
   */
  /**
   * 空回来时沿用上一批。
   *
   * 上游某张榜单偶尔整个 track 列表都不给，store 会正常返回「零首」。若照它渲染，
   * 这块会从页面上消失、按钮也跟着没了。留一份最近的非空顺序顶住。
   */
  const lastFresh = useRef<Track[]>([])
  useEffect(() => {
    if (freshOrder.length > 0) lastFresh.current = freshOrder
  }, [freshOrder])
  const freshRows = freshOrder.length > 0 ? freshOrder : lastFresh.current

  const freshTracks = useMemo(() => {
    const size = SLOTS.fresh
    if (freshRows.length <= size) return freshRows
    const start = (freshBatch * size) % freshRows.length
    const out = freshRows.slice(start, start + size)
    if (out.length < size) out.push(...freshRows.slice(0, size - out.length))
    return out
  }, [freshRows, freshBatch])

  const leadIndex = freshTracks[freshLead] ? freshLead : 0
  const leadTrack = freshTracks[leadIndex]

  /*
   * 首帧的那一下。
   *
   * 这一页的每一块数据都来自不同接口，谁先到谁先出现，于是打开的头一秒里
   * 页面总高从 971 涨到 2811 —— 用户看到的是「内容一块块往下挤」。骨架不解决
   * 数据快慢，只解决「框的位置提前定好」：先按真实版式画占位，数据到了填空。
   * 数据一直不来（离线、接口挂了）就把占位收掉，不留一排空框假装在加载。
   */
  useEffect(() => {
    setFreshLead(0)
    // 换一批之后列表还停在上一批滚到的位置，人会以为没换到；回到顶上。
    const list = freshList.current
    if (list) list.scrollTop = 0
  }, [freshBatch, freshTick])

  const [settled, setSettled] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1600)
    return () => window.clearTimeout(timer)
  }, [])

  /*
   * 三张预览图等平台那一份落地再画。
   *
   * 平台推荐还没回来时 daily 先用本机曲库补齐，于是这三张会先画一次；几百毫秒后
   * 平台数据到、daily 重算，三张整组换源——旧图消失、新图逐张加载，录屏里那块
   * 就是在这段时间里反复变。等到了再一次画，中间的等待用同尺寸的 tint 块占位。
   *
   * 兜底单独放宽到 3 秒而不是复用上面那道 1.6 秒的 settled：录屏里新图 3.5 秒才
   * 全部到位，1.6 秒一触发就先画了本机那组、平台回来再换掉，等于把要消的动作
   * 留着。这道兜底只赌「请求永远不回来」这一种情况，多等两个色块好过再闪一次。
   */
  const [dailyArtSettled, setDailyArtSettled] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setDailyArtSettled(true), 3000)
    return () => window.clearTimeout(timer)
  }, [])
  const dailyArtReady = platformDailyReady || dailyArtSettled

  const now = new Date()

  return (
    <div className="rh">
      <header className="rh__head">
        <p className="rh__greet">{greeting(now)}</p>
        {today.tracks > 0 ? (
          <p className="rh__today">
            今天 {today.tracks} 首 · {formatSpan(today.seconds)}
            {today.topArtist ? (
              <span className="rh__top">最常听 {today.topArtist}</span>
            ) : null}
          </p>
        ) : null}
      </header>

      {daily.length > 0 ? (
        <section className="rh-daily">
          <div className="rh-daily__text">
            <span className="rh-daily__kicker">每日推荐 · {new Date().getMonth() + 1} 月 {new Date().getDate()} 日</span>
            <h2>今天听什么</h2>
            <div className="rh-daily__acts">
              <button
                className="rh-btn rh-btn--main"
                type="button"
                onClick={() => player.playQueue(daily, 0)}
              >
                <Play size={15} />
                开始播放
              </button>
              <button
                className="rh-more"
                type="button"
                onClick={() => onNavigate({ view: 'daily' })}
              >
                全部 {daily.length} 首
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
          <DiscWall
            tiles={
              dailyArtReady
                ? dailyArt.map((track) => ({
                    key: track.id,
                    label: track.title + (track.artist ? ' · ' + track.artist : ''),
                    art: thumbOf(track, 200) ?? coverFor(track.id, 132),
                    tint: tintCss(track.id)
                  }))
                : // 与真图同尺寸同位置，落地时只换里面的内容，不推动版式。
                  Array.from({ length: 12 }, (_, slot) => ({
                    key: 'daily-wait-' + slot,
                    label: '',
                    art: null,
                    tint: tintCss('daily-wait-' + slot)
                  }))
            }
            onPlay={(index) => {
              const track = dailyArt[index]
              const at = track ? daily.indexOf(track) : -1
              if (at >= 0) player.playQueue(daily, at)
            }}
          />
        </section>
      ) : !settled ? (
        <section className="rh-daily is-sk" aria-hidden="true" />
      ) : null}

      {focus ? (
        <section className="rh-now">
          <button
            className="rh-now__art"
            type="button"
            onClick={() => onNavigate({ view: 'track', id: focus.id })}
            title="详情"
            style={tintOf(focus.id)}
          >
            <Artwork src={focusArt} alt="" fallback={<Note size={18} />} priority />
          </button>
          <div className="rh-now__text">
            <span className="rh-now__kicker">
              {isPlayingFocus ? '正在播放 · ' : '上次听到 · '}
              {sourceName(focus)}
            </span>
            <span className="rh-now__title">{focus.title}</span>
            <span className="rh-now__sub"><ArtistName track={focus} /></span>
          </div>
          <div className="rh-now__acts">
            <button
              className="rh-btn rh-btn--main"
              type="button"
              onClick={() => (isPlayingFocus ? player.toggle() : player.playTrack(focus))}
            >
              {isPlayingFocus && playing ? <Pause size={15} /> : <Play size={15} />}
              {isPlayingFocus && playing ? '暂停' : '播放'}
            </button>
            <button
              className={'rh-btn' + (focusLiked ? ' is-on' : '')}
              type="button"
              onClick={() => useFavorites.getState().toggle(focus)}
            >
              <Heart size={15} />
              {focusLiked ? '已喜欢' : '喜欢'}
            </button>
            <button
              className="rh-btn"
              type="button"
              onClick={() => onNavigate({ view: 'track', id: focus.id })}
            >
              详情
            </button>
          </div>
        </section>
      ) : null}
      {!focus && !settled ? <SkeletonNow /> : null}

      <div className="rh-quick">
        <Shortcut
          icon={<Heart size={16} />}
          art={thumbOf(likedAll[0])}
          label="我喜欢的音乐"
          count={settled ? likedAll.length + ' 首' : '—'}
          onClick={() => onNavigate({ view: 'liked' })}
        />
        <Shortcut
          icon={<Play size={16} />}
          art={thumbOf(recentTracks[0])}
          label="最近播放"
          count={settled ? recent.length + ' 首' : '—'}
          onClick={() => onNavigate({ view: 'recent' })}
        />
        <Shortcut
          icon={<List size={16} />}
          art={mineArt}
          label="歌单"
          count={settled ? accountCards.length + ' 个' : '—'}
          onClick={() => onNavigate({ view: 'playlists' })}
        />
        {/*
         * 一张卡，里面两个入口：收藏歌单与收藏专辑分开走。
         *
         * 本机音乐不再占这一格——这是各平台的客户端，本机文件在左栏留着就够了。
         * 收藏也不做聚合页：进来还是各看各的，只是入口并在一张卡里。
         */}
        <div className="rh-sc rh-sc--split">
          <div className="rh-sc__head">
            <span className={'rh-sc__icon' + (collectionArt ? ' rh-sc__icon--art' : '')}>
              {collectionArt ? <img src={collectionArt} alt="" loading="lazy" /> : <Folder size={16} />}
            </span>
            <span className="rh-sc__text">
              <b>我的收藏</b>
              <span>
                {settled
                  ? collectedPlaylists.length + ' 张歌单 · ' + collectedAlbums.length + ' 张专辑'
                  : '—'}
              </span>
            </span>
          </div>
          <div className="rh-sc__links">
            <button type="button" onClick={() => onNavigate({ view: 'playlists' })}>
              收藏歌单
              <ChevronRight size={12} />
            </button>
            <button type="button" onClick={() => onNavigate({ view: 'collections' })}>
              收藏专辑
              <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>

      {allHidden ? (
        <div className="rh-hidden">
          <p>推荐歌单、推荐专辑、最近新歌、最近听过 都关掉了，首页只剩这些。</p>
          <button type="button" className="btn" onClick={() => onNavigate({ view: 'settings' })}>
            去设置 → 首页里打开
          </button>
        </div>
      ) : null}

      {homeSections.playlists && (!cardsReady || picks.length > 0) ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>推荐歌单</h3>
            <button className="rh-more" type="button" onClick={() => setBatch((n) => n + 1)}>
              换一批
            </button>
          </header>
          <div className="rh-row">
            {/*
             * 没到齐之前一格真卡都不画，只留占位：占位张数按最终的两行给，
             * 数据一到位整排一次换过来——不会先长六张、再补六张。
             */}
            {cardsReady ? (
              <>
                {picks.map((row, at) => (
              <button
                className="rh-card"
                type="button"
                key={row.key}
                onClick={() => openOnlinePlaylist(row.providerId, row)}
              >
                <span className="rh-card__art" style={tintOf(row.key)}>
                  <Artwork
                    src={row.coverUrl ? remoteImageUrl(sizedImage(row.coverUrl, 360), 360) : null}
                    alt=""
                    fallback={<Note size={20} />}
                    priority={at < 6}
                  />
                  <span className={'pl-card__src src-dot--' + row.providerId}>{row.providerLabel}</span>
                </span>
                <span className="rh-card__title">{row.name}</span>
                {row.creator ? <span className="rh-card__sub">{row.creator}</span> : null}
                  </button>
                ))}
              </>
            ) : (
              <SkeletonCards count={SLOTS.playlist} />
            )}
          </div>
        </section>
      ) : null}

      {homeSections.albums && (!cardsReady || albumPicks.length > 0) ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>
              推荐专辑
              {albumSources.length > 0 ? (
                <span className="rh-sec__note">{albumSources.join(' · ')}</span>
              ) : null}
            </h3>
            <div className="rh-sec__acts">
              <button
                className="rh-nav"
                type="button"
                aria-label="往前翻几张专辑"
                onClick={() => slideAlbums(-1)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                className="rh-nav"
                type="button"
                aria-label="往后翻几张专辑"
                onClick={() => slideAlbums(1)}
              >
                <ChevronRight size={15} />
              </button>
              <button className="rh-more" type="button" onClick={() => setAlbumBatch((n) => n + 1)}>
                换一批
              </button>
            </div>
          </header>
          {/*
           * 跟歌单同一道闸：没到齐只画占位，到齐整排一次换过来。
           * 这排尤其要等齐——网易云的新碟榜最快，先画就是「一整排网易云」。
           */}
          {/*
           * 专辑不排封面墙：歌单已经是三行六列的方卡了，两者并排几乎看不出区别。
           * 这里改成横条——小方图在左、专辑名与艺人在右，两行四列往下走一格，
           * 与歌单的「墙」错开节奏，也把「这是作品不是合集」写进形状里。
           */}
          <div className="rh-alb-list" ref={albumStrip}>
            {cardsReady ? (
              <>
                {albumPicks.map((row, at) => (
                  <button
                    className="rh-alb-row"
                    type="button"
                    key={row.key}
                    onClick={() => openOnlineAlbum(row.providerId, row.id)}
                  >
                    <span className="rh-alb-row__art" style={tintOf(row.key)}>
                      <Artwork
                        src={row.coverUrl ? remoteImageUrl(sizedImage(row.coverUrl, 240), 240) : null}
                        alt=""
                        fallback={<Note size={16} />}
                        priority={at < 4}
                      />
                    </span>
                    <span className="rh-alb-row__main">
                      <span className="rh-alb-row__title">{row.name}</span>
                      <span className="rh-alb-row__sub">
                        <span className="rh-alb-row__name">
                          <ArtistById providerId={row.providerId} id={row.artistId} name={row.artistName} />
                        </span>
                        {row.platforms.length > 0 ? (
                          <span className="rh-alb-row__srcs">
                            {row.platforms.map((on) => on.providerLabel).join(' / ')}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <SkeletonAlbums count={SLOTS.album} />
            )}
          </div>
        </section>
      ) : null}

      {homeSections.fresh && (freshTracks.length > 0 || !settled) ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>最近新歌</h3>
            <button
              className="rh-more"
              type="button"
              onClick={() => {
                setFreshBatch((n) => n + 1)
                setFreshTick((n) => n + 1)
                //
                // 网易云那份不能只是重取：一天只有一份新歌，重发拿回同一个列表，按钮
                // 看起来就是没反应。走 next 把游标往前推一页，主进程会换到下一个榜单。
                void useDiscover.getState().next('newsongs').catch(() => {})
              }}
            >
              换一批
            </button>
          </header>
          {freshTracks.length > 0 ? (
            <div className="rh-fresh" onMouseLeave={() => setFreshLead(0)}>
              {leadTrack ? (
                <button
                  className="rh-fresh__lead"
                  key={leadTrack.id}
                  type="button"
                  onClick={() => player.playQueue(freshTracks, leadIndex)}
                  title={'播放 ' + (leadTrack.title || '这首歌')}
                >
                  <span className="rh-fresh__lead-art" style={tintOf(leadTrack.id)}>
                    <Artwork
                      src={artThumbFor(leadTrack, 640) ?? coverFor(leadTrack.id, 640)}
                      alt=""
                      fallback={<Note size={22} />}
                      priority={leadIndex === 0}
                    />
                    <span className="rh-fresh__lead-play" aria-hidden>
                      <Play size={16} />
                    </span>
                  </span>
                  <span className="rh-fresh__lead-kicker">
                    {leadIndex === 0 ? '本周新歌' : '第 ' + (leadIndex + 1) + ' 首'}
                  </span>
                  <span className="rh-fresh__lead-title">{leadTrack.title || '（无标题）'}</span>
                  <span className="rh-fresh__lead-sub">
                    {(leadTrack.artist || '未知艺术家') + ' · ' + sourceName(leadTrack)}
                  </span>
                </button>
              ) : null}
              <div className="rh-fresh__list" ref={freshList} key={'fresh-' + freshBatch}>
                {freshTracks.slice(1).map((track, at) => (
                  <button
                    className={'rh-fresh__row' + (at + 1 === leadIndex ? ' is-lead' : '')}
                    type="button"
                    key={track.id}
                    onMouseEnter={() => setFreshLead(at + 1)}
                    onFocus={() => setFreshLead(at + 1)}
                    onClick={() => player.playQueue(freshTracks, at + 1)}
                    title={'播放 ' + (track.title || '这首歌')}
                  >
                    <span className="rh-fresh__row-idx tnum">{at + 2}</span>
                    <span className="rh-fresh__row-art">
                      <Artwork
                        src={artThumbFor(track) ?? coverFor(track.id, 96)}
                        alt=""
                        fallback={<Note size={14} />}
                      />
                    </span>
                    <span className="rh-fresh__row-main">
                      <span className="rh-fresh__row-title">{track.title || '（无标题）'}</span>
                      <span className="rh-fresh__row-sub">
                        {(track.artist || '未知艺术家') + ' · ' + sourceName(track)}
                      </span>
                    </span>
                    <span className="rh-fresh__row-dur tnum">
                      {track.duration > 0 ? formatTime(track.duration) : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <SkeletonFresh rows={SLOTS.fresh - 1} />
          )}
        </section>
      ) : null}

      {homeSections.recent && (recentTracks.length > 0 || !settled) ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>最近听过</h3>
            <button className="rh-more" type="button" onClick={() => onNavigate({ view: 'recent' })}>
              全部
              <ChevronRight size={13} />
            </button>
          </header>
          <div className="rh-row rh-row--tight">
            {recentTracks.length === 0 ? <SkeletonCards count={ROW} /> : null}
            {recentTracks.map((track) => (
              <button
                className="rh-card"
                type="button"
                key={track.id}
                onClick={() => player.playTrack(track)}
              >
                <span
                  className="rh-card__art"
                  style={tintOf(track.id)}
                >
                  <Artwork src={artworkFor(track)} alt="" fallback={<Note size={20} />} />
                </span>
                <span className="rh-card__title">{track.title}</span>
                <span className="rh-card__sub">{sinceLabel(recentAt.get(track.id) ?? 0)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

/** 首屏那条「正在播放 / 上次听到」的横带，还没有内容时先占住它的高度。 */
function SkeletonNow() {
  return (
    <section className="rh-now is-sk" aria-hidden="true">
      <span className="rh-now__art" style={tintOf('sk-now')} />
      <div className="rh-now__text">
        <span className="rh-now__kicker">{'\u00A0'}</span>
        <span className="rh-now__title">{'\u00A0'}</span>
        <span className="rh-now__sub">{'\u00A0'}</span>
      </div>
    </section>
  )
}

function Shortcut({
  icon,
  art,
  label,
  count,
  onClick
}: {
  icon: ReactNode
  art: string | null
  label: string
  count: string
  onClick(): void
}) {
  /* 取不到图就退回图标：宁可少一张封面，也不留浏览器那张碎图。 */
  const [broken, setBroken] = useState(false)
  const showArt = art !== null && !broken
  return (
    <button className="rh-sc" type="button" onClick={onClick}>
      <span className={'rh-sc__icon' + (showArt ? ' rh-sc__icon--art' : '')}>
        {showArt ? (
          <img src={art} alt="" loading="eager" fetchPriority="high" onError={() => setBroken(true)} />
        ) : (
          icon
        )}
      </span>
      <span className="rh-sc__text">
        <b>{label}</b>
        <span>{count}</span>
      </span>
      <ChevronRight size={14} />
    </button>
  )
}