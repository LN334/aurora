import { useEffect, useMemo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { ShellRoute } from '../app/shell'
import { useDiscover } from '../features/discover/store'
import { dailyTracks } from '../features/library/daily'
import { useFavorites } from '../features/favorites/store'
import { artworkFor } from '../features/library/source'
import { groupAlbums, useLibrary } from '../features/library/store'
import { useNetease } from '../features/netease/store'
import { player } from '../features/player/actions'
import { useRecentEntries, useToday } from '../features/player/history-store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { usePlayer } from '../features/player/store'
import { usePlaylists } from '../features/playlists/store'
import type { Track } from '../types'
import { Artwork } from '../ui/Artwork'
import { formatTime } from '../ui/format'
import { ChevronRight, Folder, Heart, List, Note, Pause, Play } from '../ui/icons'
import type { NeteaseSong } from '../env'

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

  const pickBlock = useDiscover((state) => state.blocks.playlists)
  const newBlock = useDiscover((state) => state.blocks.newsongs)
  const qualityBlock = useDiscover((state) => state.blocks.quality)

  useEffect(() => {
    // 失败就整块不出现，不在首屏留一行报错——曲库里的东西够填满这一页了。
    void useDiscover.getState().load('playlists').catch(() => {})
    void useDiscover.getState().load('newsongs').catch(() => {})
    void useDiscover.getState().load('quality').catch(() => {})
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

  /**
   * 今天听什么。
   *
   * 别人的主页第一屏几乎都是这个东西：一个「今天不用想，点开就有」的入口。
   * 网易云的每日推荐要登录接口，这里先用曲库自己生成——按日期做种子洗一遍，
   * 同一天打开是同一批，明天换掉。接口接上以后换数据源，版式不用动。
   */
  const daily = useMemo(() => {
    // 本机一首都没有时退到最近播放：对在线用户来说那也是「我的歌」。
    const pool = tracks.length > 0 ? tracks : recentAll
    return dailyTracks(pool)
  }, [tracks, recentAll])

  const picks = pickBlock.playlists.slice(0, 6)
  const fresh = newBlock.songs.slice(0, 6)

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
          <div className="rh-daily__text">
            <span className="rh-daily__kicker">每日推荐 · {new Date().getMonth() + 1} 月 {new Date().getDate()} 日</span>
            <h2>今天听什么</h2>
            <p>
              {tracks.length > 0 ? '从你的曲库里挑' : '从最近听过的歌里挑'} {daily.length} 首，明天换一批
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
              <button
                className="rh-more"
                type="button"
                onClick={() => onNavigate({ view: 'daily' })}
              >
                今天这一批
                <ChevronRight size={13} />
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
            <h3>为你挑选</h3>
            <button
              className="rh-more"
              type="button"
              onClick={() => void useDiscover.getState().next('playlists')}
              disabled={pickBlock.status === 'loading'}
            >
              {pickBlock.status === 'loading' ? '读取中' : '换一批'}
            </button>
          </header>
          <div className="rh-row">
            {picks.map((playlist) => (
              <button
                className="rh-card"
                type="button"
                key={playlist.id}
                onClick={() => onNavigate({ view: 'netease' })}
              >
                <span
                  className="rh-card__art"
                  style={playlist.coverUrl ? undefined : tintOf(String(playlist.id))}
                >
                  <Artwork
                    src={playlist.coverUrl ? remoteImageUrl(sizedImage(playlist.coverUrl, 360)) : null}
                    alt=""
                    fallback={<Note size={20} />}
                  />
                </span>
                <span className="rh-card__title">{playlist.name}</span>
                <span className="rh-card__sub">{playlist.creator || '网易云音乐'}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {qualityBlock.playlists.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>精品歌单</h3>
            <button
              className="rh-more"
              type="button"
              onClick={() => void useDiscover.getState().next('quality')}
              disabled={qualityBlock.status === 'loading'}
            >
              {qualityBlock.status === 'loading' ? '读取中' : '换一批'}
            </button>
          </header>
          <div className="rh-scroller">
            {qualityBlock.playlists.slice(0, 12).map((playlist) => (
              <button
                className="rh-mini"
                type="button"
                key={playlist.id}
                onClick={() => onNavigate({ view: 'netease' })}
              >
                <span
                  className="rh-mini__art"
                  style={playlist.coverUrl ? undefined : tintOf(String(playlist.id))}
                >
                  <Artwork
                    src={playlist.coverUrl ? remoteImageUrl(sizedImage(playlist.coverUrl, 240)) : null}
                    alt=""
                    fallback={<Note size={18} />}
                  />
                </span>
                <span className="rh-mini__title">{playlist.name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {fresh.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>新歌</h3>
            <button className="rh-more" type="button" onClick={() => onNavigate({ view: 'netease' })}>
              更多
              <ChevronRight size={13} />
            </button>
          </header>
          <div className="rh-songs">
            {fresh.map((song, at) => (
              <SongRow
                key={song.id}
                song={song}
                onPlay={() => void useNetease.getState().playSongsAt(newBlock.songs, at)}
              />
            ))}
          </div>
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

function SongRow({ song, onPlay }: { song: NeteaseSong; onPlay(): void }) {
  const cover = song.album?.picUrl
  return (
    <button className="rh-song" type="button" onClick={onPlay} title={'播放 ' + song.name}>
      <span className="rh-song__art" style={cover ? undefined : tintOf(String(song.id))}>
        {cover ? (
          <img src={remoteImageUrl(sizedImage(cover, 120))} alt="" loading="lazy" decoding="async" />
        ) : (
          <Note size={15} />
        )}
      </span>
      <span className="rh-song__text">
        <b>{song.name}</b>
        <span>{song.artists.map((artist) => artist.name).join(' / ')}</span>
      </span>
      <Play size={14} />
    </button>
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
