import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ShellRoute } from '../app/shell'
import { useDiscover } from '../features/discover/store'
import { dailyTracks } from '../features/library/daily'
import { useFavorites } from '../features/favorites/store'
import { artworkFor } from '../features/library/source'
import { groupAlbums, useLibrary } from '../features/library/store'
import { toTrack } from '../features/netease/track'
import { player } from '../features/player/actions'
import { useRecentEntries, useToday } from '../features/player/history-store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { usePlayer } from '../features/player/store'
import { usePlaylists } from '../features/playlists/store'
import { openOnlinePlaylist } from '../features/refs/navigate'
import { usePlatformDaily } from '../features/online/daily'
import { usePlatformNewSongs } from '../features/online/news'
import { interleaveByProvider, useShelves, windowOf } from '../features/online/shelves'
import { mergeVersions } from '../features/online/unify'
import { useSourceOrder } from '../features/settings/source-order'
import type { Track } from '../types'
import { Artwork } from '../ui/Artwork'
import { formatTime } from '../ui/format'
import { TrackList } from '../ui/TrackList'
import { ChevronRight, Folder, Heart, List, Note, Pause, Play } from '../ui/icons'

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
  qq: 'QQ 音乐'
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

/** 一排卡最多几张。宽窗口一行放得下六张，再多就要横向滚了。 */
const ROW = 6

/**
 * 卡片副标题：先报首数，没有首数就报它从哪来。
 *
 * 酷狗的公开榜单不给曲目总数，接口里就是 0。直接写「0 首」比不写更糟——
 * 看起来像一张空单子。
 */
function shelfSub(row: { trackCount: number; creator: string; providerLabel: string }): string {
  const first = row.trackCount > 0 ? row.trackCount + ' 首' : row.providerLabel
  return row.creator ? first + ' · ' + row.creator : first
}

interface HomeViewProps {
  onNavigate(route: ShellRoute): void
}

export function HomeView({ onNavigate }: HomeViewProps) {
  const queue = usePlayer((state) => state.queue)
  const index = usePlayer((state) => state.index)
  const playing = usePlayer((state) => state.playing)

  const liked = useFavorites((state) => state.liked)
  const playlists = usePlaylists((state) => state.playlists)
  const tracks = useLibrary((state) => state.tracks)
  const albums = useMemo(() => groupAlbums(tracks), [tracks])

  const recent = useRecentEntries()
  const today = useToday()

  const newBlock = useDiscover((state) => state.blocks.newsongs)

  /**
   * 推荐歌单不再只问网易云一家。
   *
   * 四家的单子本来就都在手边（账号一登录就有），再向其中一家的推荐接口要
   * 一份是多余的：主页该显示「你有这些」，而不是「网易云觉得你该听这些」。
   */
  const shelves = useShelves()
  const [batch, setBatch] = useState(0)
  const deck = useMemo(() => interleaveByProvider(shelves), [shelves])

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

  const order = useSourceOrder()
  const platformDaily = usePlatformDaily()

  /**
   * 今天听什么。
   *
   * 别人的主页第一屏几乎都是这个东西：一个「今天不用想，点开就有」的入口。
   * 池子是本机曲库 + 已登录平台的每日推荐，按日期做种子洗一遍，同一天打开是
   * 同一批，明天换掉。平台推荐放在这里而不是另起一块，是因为它和曲库本来就是
   * 同一种东西——「今天听哪些」，平台不该独占一个分区。
   */
  const daily = useMemo(() => {
    // 本机一首都没有时退到最近播放：对在线用户来说那也是「我的歌」。
    const base = tracks.length > 0 ? tracks : recentAll
    // 合并会把同曲的两个平台版本并在同一行，播放时由音源优先级挑一个。
    return dailyTracks(mergeVersions([...base, ...platformDaily], order))
  }, [tracks, recentAll, platformDaily, order])

  /**
   * 一批十二张，正好两行六列。
   *
   * 一屏只给六张太薄：四家轮一遍就没了，看起来像只接了一两家。两行铺满之后
   * 每一家在首屏都能出三张，「换一批」再往后挪一屏。
   */
  const PER_BATCH = ROW * 2
  const picks = useMemo(() => windowOf(deck, batch * PER_BATCH, PER_BATCH), [deck, batch])
  const more = useMemo(() => windowOf(deck, batch * PER_BATCH + PER_BATCH, 12), [deck, batch])
  /**
   * 新歌不再只有网易云一家。
   *
   * 网易云那份来自发现页的缓存，QQ 与酷狗从各自的新歌榜现取（都不需要登录）；
   * 三家合成之后同一个歌名只会占一行，平台徽章并排，点播放仍按音源优先级选。
   * 取前六行：再多就要往下滚，首屏的重点是歌单。
   */
  const platformFresh = usePlatformNewSongs(20)
  const freshTracks = useMemo(() => {
    const base = newBlock.songs.map((song) => toTrack(song))
    const merged = mergeVersions([...base, ...platformFresh], order)

    // 按源轮转取六行。直接按优先级排会变成「网易云前十首」，另外两家永远
    // 进不了首屏——那和只接一家看起来没有区别。
    const buckets = new Map<string, Track[]>()
    for (const track of merged) {
      const key = track.source ?? 'local'
      const bucket = buckets.get(key)
      if (bucket) bucket.push(track)
      else buckets.set(key, [track])
    }

    const out: Track[] = []
    for (let at = 0; out.length < 6 && at < 24; at += 1) {
      for (const bucket of buckets.values()) {
        const next = bucket[at]
        if (next && out.length < 6) out.push(next)
      }
    }
    return out
  }, [newBlock.songs, platformFresh, order])

  const now = new Date()
  const hasRecommend = picks.length > 0

  return (
    <div className="rh">
      <header className="rh__head">
        <div>
          <p className="rh__greet">{greeting(now)}</p>
          {today.tracks > 0 ? (
            <p className="rh__today">
              今天 {today.tracks} 首 · {formatTime(today.seconds)}
            </p>
          ) : null}
        </div>
      </header>

      {focus ? (
        <section className="rh-now">
          <button
            className="rh-now__art"
            type="button"
            onClick={() => onNavigate({ view: 'track', id: focus.id })}
            title="详情"
            style={focusArt ? undefined : tintOf(focus.id)}
          >
            <Artwork src={focusArt} alt="" fallback={<Note size={18} />} />
          </button>
          <div className="rh-now__text">
            <span className="rh-now__kicker">
              {isPlayingFocus ? '正在播放 · ' : '上次听到 · '}
              {sourceName(focus)}
            </span>
            <span className="rh-now__title">{focus.title}</span>
            <span className="rh-now__sub">{focus.artist}</span>
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

      <div className="rh-quick">
        <Shortcut
          icon={<Heart size={16} />}
          label="我喜欢的音乐"
          count={liked.length + ' 首'}
          onClick={() => onNavigate({ view: 'liked' })}
        />
        <Shortcut
          icon={<Play size={16} />}
          label="最近播放"
          count={recent.length + ' 首'}
          onClick={() => onNavigate({ view: 'recent' })}
        />
        <Shortcut
          icon={<List size={16} />}
          label="歌单"
          count={playlists.length + ' 个'}
          onClick={() => onNavigate({ view: 'playlists' })}
        />
        <Shortcut
          icon={<Folder size={16} />}
          label="本机音乐"
          count={albums.length + ' 张专辑'}
          onClick={() => onNavigate({ view: 'local' })}
        />
      </div>

      {daily.length > 0 ? (
        <section className="rh-daily">
          <button
            className="rh-more rh-daily__all"
            type="button"
            onClick={() => onNavigate({ view: 'daily' })}
          >
            全部 {daily.length} 首
            <ChevronRight size={13} />
          </button>
          <div className="rh-daily__text">
            <span className="rh-daily__kicker">每日推荐 · {new Date().getMonth() + 1} 月 {new Date().getDate()} 日</span>
            <h2>今天听什么</h2>
            <p>
              {platformDaily.length > 0
                ? '从曲库和平台推荐里挑'
                : tracks.length > 0
                  ? '从你的曲库里挑'
                  : '从最近听过的歌里挑'}{' '}
              {daily.length} 首，明天换一批
            </p>
            <div className="rh-daily__acts">
              <button
                className="rh-btn rh-btn--main"
                type="button"
                onClick={() => player.playQueue(daily, 0)}
              >
                <Play size={15} />
                开始播放
              </button>
            </div>
          </div>
          <div className="rh-daily__art">
            {daily.slice(0, 3).map((track) => (
              <span key={track.id} className="rh-daily__tile" style={artworkFor(track) ? undefined : tintOf(track.id)}>
                <Artwork src={artworkFor(track)} alt="" fallback={null} />
              </span>
            ))}
          </div>
        </section>
      ) : null}

      {hasRecommend ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>歌单</h3>
            <button className="rh-more" type="button" onClick={() => setBatch((n) => n + 1)}>
              换一批
            </button>
          </header>
          <div className="rh-row">
            {picks.map((row) => (
              <button
                className="rh-card"
                type="button"
                key={row.key}
                onClick={() => openOnlinePlaylist(row.providerId, row.id)}
              >
                <span className="rh-card__art" style={row.coverUrl ? undefined : tintOf(row.key)}>
                  <Artwork
                    src={row.coverUrl ? remoteImageUrl(sizedImage(row.coverUrl, 360)) : null}
                    alt=""
                    fallback={<Note size={20} />}
                  />
                  <span className={'pl-card__src src-dot--' + row.providerId}>{row.providerLabel}</span>
                </span>
                <span className="rh-card__title">{row.name}</span>
                <span className="rh-card__sub">{shelfSub(row)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {more.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>更多歌单</h3>
          </header>
          <div className="rh-scroller">
            {more.map((row) => (
              <button
                className="rh-mini"
                type="button"
                key={row.key}
                onClick={() => openOnlinePlaylist(row.providerId, row.id)}
              >
                <span className="rh-mini__art" style={row.coverUrl ? undefined : tintOf(row.key)}>
                  <Artwork
                    src={row.coverUrl ? remoteImageUrl(sizedImage(row.coverUrl, 240)) : null}
                    alt=""
                    fallback={<Note size={18} />}
                  />
                  <span className={'pl-card__src src-dot--' + row.providerId}>{row.providerLabel}</span>
                </span>
                <span className="rh-mini__title">{row.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {freshTracks.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>新歌</h3>
          </header>
          <TrackList
            tracks={freshTracks}
            currentId={current?.id ?? null}
            playing={playing}
            onPlayAt={(at) => player.playQueue(freshTracks, at)}
          />
        </section>
      ) : null}

      {recentTracks.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>最近听过</h3>
            <button className="rh-more" type="button" onClick={() => onNavigate({ view: 'recent' })}>
              全部
              <ChevronRight size={13} />
            </button>
          </header>
          <div className="rh-row">
            {recentTracks.map((track) => (
              <button
                className="rh-card"
                type="button"
                key={track.id}
                onClick={() => player.playTrack(track)}
              >
                <span
                  className="rh-card__art"
                  style={artworkFor(track) ? undefined : tintOf(track.id)}
                >
                  <Artwork src={artworkFor(track)} alt="" fallback={<Note size={20} />} />
                </span>
                <span className="rh-card__title">{track.title}</span>
                <span className="rh-card__sub">{track.artist}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function Shortcut({
  icon,
  label,
  count,
  onClick
}: {
  icon: ReactNode
  label: string
  count: string
  onClick(): void
}) {
  return (
    <button className="rh-sc" type="button" onClick={onClick}>
      <span className="rh-sc__icon">{icon}</span>
      <span className="rh-sc__text">
        <b>{label}</b>
        <span>{count}</span>
      </span>
      <ChevronRight size={14} />
    </button>
  )
}
