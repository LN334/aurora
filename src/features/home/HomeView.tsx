import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Route } from '../../app/routing'
import type { Track } from '../../types'
import { Artwork } from '../../ui/Artwork'
import { formatTime } from '../../ui/format'
import { Compass, Library, Note, Pause, Play, Search } from '../../ui/icons'
import { useHistoryState, useRecentEntries, useToday } from '../player/history-store'
import { player } from '../player/actions'
import { usePlayer } from '../player/store'
import { artworkFor } from '../library/source'
import { groupAlbums, groupArtists, useLibrary } from '../library/store'
import { usePlaylists } from '../playlists/store'
import { DiscoverView } from '../discover/DiscoverView'
import './home.css'

/**
 * 主页：一屏之内回答三个问题——接着听什么、库里有什么、今天听了多少。
 *
 * 结构照 Mineradio 的信息架构（一张主卡 + 一排快捷入口 + 今日指标 + 最近 +
 * 平台推荐），视觉仍用 Aurora 自己的暗色与封面主色，不搬它的皮肤。
 * 全站唯一的一级标题由外壳打（「主页」），所以这里从次级标题起。
 */

const QUICK_LABELS = ['继续播放', '音乐库', '每日推荐', '最近播放']

function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function dateText(now: Date): string {
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  return now.getMonth() + 1 + ' 月 ' + now.getDate() + ' 日 · ' + week
}

function playTrack(track: Track): void {
  player.playTrack(track)
}

interface QuickCardProps {
  label: string
  title: string
  sub: string
  icon: ReactNode
  onClick(): void
}

function QuickCard({ label, title, sub, icon, onClick }: QuickCardProps) {
  return (
    <button className="home-card" type="button" onClick={onClick}>
      <span className="home-card__label">
        <span className="home-card__icon">{icon}</span>
        {label}
      </span>
      <span className="home-card__title">{title}</span>
      <span className="home-card__sub">{sub}</span>
    </button>
  )
}

export function HomeView({ onNavigate, section }: { onNavigate(route: Route): void; section?: string }) {
  const tracks = useLibrary((state) => state.tracks)
  const playlists = usePlaylists((state) => state.playlists)

  const queue = usePlayer((state) => state.queue)
  const index = usePlayer((state) => state.index)
  const playing = usePlayer((state) => state.playing)
  const position = usePlayer((state) => state.position)

  const history = useHistoryState()
  const recent = useRecentEntries()
  const today = useToday()

  const recentRef = useRef<HTMLElement | null>(null)
  const picksRef = useRef<HTMLElement | null>(null)
  const insightRef = useRef<HTMLDivElement | null>(null)

  const albums = useMemo(() => groupAlbums(tracks), [tracks])
  const artists = useMemo(() => groupArtists(tracks), [tracks])

  const current = index >= 0 ? (queue[index] ?? null) : null
  /* 没在播的时候，把「上次听到的」当作 hero，避免首屏是一块空白。 */
  const hero = current ?? recent[0]?.track ?? null
  const next = index >= 0 ? (queue[index + 1] ?? null) : null

  const now = new Date()

  const onHeroPlay = () => {
    if (!hero) return
    if (current) player.toggle()
    else playTrack(hero)
  }

  const recentRows = recent.slice(0, 10)

  /*
   * 侧栏「主页」下面的三个子项不是三个页面，是这一页里的三块。点了滚过去；
   * route.tab 一变化就滚一次，所以从别处点「最近播放」也能落到位。
   */
  useEffect(() => {
    const targets: Record<string, HTMLElement | null> = {
      recent: recentRef.current,
      picks: picksRef.current,
      insight: insightRef.current
    }
    const node = section ? targets[section] : null
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [section])

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero__text">
          <p className="home-hero__kicker">
            {greeting(now)} · {dateText(now)}
          </p>
          <div className="home-hero__title">{hero ? hero.title : '从一首歌开始'}</div>
          <p className="home-hero__sub">
            {hero
              ? [hero.artist, hero.album].filter(Boolean).join(' · ')
              : '曲库是空的，也没有播放记录。加一个音乐文件夹，或者从下面的推荐里挑一张。'}
          </p>
          <div className="home-hero__actions">
            <button className="btn btn--accent" type="button" disabled={!hero} onClick={onHeroPlay}>
              {current && playing ? (
                <>
                  <Pause size={15} /> 暂停
                </>
              ) : (
                <>
                  <Play size={15} /> {current ? '继续播放' : '播放'}
                </>
              )}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => onNavigate({ view: 'library', source: 'local', tab: 'songs' })}
            >
              <Library size={15} /> 音乐库
            </button>
            <button className="btn" type="button" onClick={() => onNavigate({ view: 'search' })}>
              <Search size={15} /> 搜索
            </button>
          </div>
          {hero && position > 0 && current ? (
            <p className="home-hero__progress">上次听到 {formatTime(position)}</p>
          ) : null}
        </div>
        <div className="home-hero__art">
          <Artwork src={hero ? artworkFor(hero) : null} alt="" fallback={<Note size={38} />} />
        </div>
      </section>

      <div className="home-quick">
        <QuickCard
          label={QUICK_LABELS[0]}
          icon={<Play size={14} />}
          title={current ? current.title : recent[0] ? recent[0].title : '还没有播放'}
          sub={current ? current.artist + ' · 队列 ' + queue.length + ' 首' : '点一下，从上次的地方接着放'}
          onClick={onHeroPlay}
        />
        <QuickCard
          label={QUICK_LABELS[1]}
          icon={<Library size={14} />}
          title="音乐库"
          sub={tracks.length + ' 首 · ' + albums.length + ' 张专辑 · ' + artists.length + ' 位艺术家'}
          onClick={() => onNavigate({ view: 'library', source: 'local', tab: 'songs' })}
        />
        <QuickCard
          label={QUICK_LABELS[2]}
          icon={<Compass size={14} />}
          title="每日推荐"
          sub={playlists.length > 0 ? '平台推荐与你的 ' + playlists.length + ' 个歌单' : '平台推荐，不用登录也能听'}
          onClick={() => picksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
        <QuickCard
          label={QUICK_LABELS[3]}
          icon={<Note size={14} />}
          title={recentRows.length > 0 ? history.recent.length + ' 首' : '还没有记录'}
          sub={recentRows.length > 0 ? '最近放过的，点一下重放' : '听过一首歌之后这里就会有'}
          onClick={() => recentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      </div>

      <div className="home-insight" ref={insightRef}>
        <section className="home-panel">
          <h2 className="home-panel__title">今日聆听</h2>
          <div className="home-stats">
            <div className="home-stat">
              <span className="home-stat__value">{formatTime(today.seconds)}</span>
              <span className="home-stat__label">时长</span>
            </div>
            <div className="home-stat">
              <span className="home-stat__value">{today.tracks}</span>
              <span className="home-stat__label">首</span>
            </div>
            <div className="home-stat">
              <span className="home-stat__value home-stat__value--text">
                {today.topArtist ?? '—'}
              </span>
              <span className="home-stat__label">最常听</span>
            </div>
          </div>
        </section>

        <section className="home-panel">
          <h2 className="home-panel__title">接下来播放</h2>
          {next ? (
            <button className="home-next" type="button" onClick={() => player.jumpTo(index + 1)}>
              <span className="home-next__art">
                <Artwork src={artworkFor(next)} alt="" fallback={<Note size={20} />} />
              </span>
              <span className="home-next__text">
                <span className="home-next__title">{next.title}</span>
                <span className="home-next__sub">{next.artist}</span>
              </span>
              <span className="home-next__play">
                <Play size={14} />
              </span>
            </button>
          ) : (
            <p className="home-panel__empty">
              {queue.length > 0 ? '队列就到这里了。' : '队列是空的，从曲库或推荐里挑一首。'}
            </p>
          )}
        </section>
      </div>

      <section className="home-recent" ref={recentRef}>
        <div className="home-section-head">
          <h2 className="home-panel__title">最近播放</h2>
          <span className="home-section-head__note">点一行就放</span>
        </div>
        {recentRows.length === 0 ? (
          <p className="home-panel__empty">还没有播放记录。</p>
        ) : (
          <div className="home-rows">
            {recentRows.map((entry) => (
              <button
                className="home-row"
                type="button"
                key={entry.id}
                disabled={!entry.track}
                onClick={() => entry.track && playTrack(entry.track)}
              >
                <span className="home-row__art">
                  <Artwork
                    src={entry.track ? artworkFor(entry.track) : null}
                    alt=""
                    fallback={<Note size={16} />}
                  />
                </span>
                <span className="home-row__title">{entry.title}</span>
                <span className="home-row__artist">{entry.artist}</span>
                <span className="home-row__time">{formatTime(entry.track?.duration ?? 0)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="home-picks" ref={picksRef}>
        <div className="home-section-head">
          <h2 className="home-panel__title">为你挑选</h2>
          <span className="home-section-head__note">公开推荐，不用登录</span>
        </div>
        <DiscoverView />
      </section>
    </div>
  )
}
