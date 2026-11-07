import { useEffect } from 'react'
import type { Route } from '../../app/routing'
import type { Track } from '../../types'
import { Artwork } from '../../ui/Artwork'
import { formatTime } from '../../ui/format'
import { Library, Note, Pause, Play, Search } from '../../ui/icons'
import { useRecentEntries, useToday } from '../player/history-store'
import { player } from '../player/actions'
import { usePlayer } from '../player/store'
import { artworkFor } from '../library/source'
import { remoteImageUrl, sizedImage } from '../player/urls'
import { DiscoverView } from '../discover/DiscoverView'
import { useDiscover } from '../discover/store'
import { MyMusic } from './MyMusic'
import { PlatformLoginDialogs } from '../../views/settings/panes/PlatformSignIn'
import './home.css'

/**
 * 主页：一屏之内回答三个问题——接着听什么、库里有什么、今天听了多少。
 *
 * 结构照 Mineradio 的信息架构（一张主卡 + 一排快捷入口 + 今日指标 + 最近 +
 * 平台推荐），视觉仍用 Aurora 自己的暗色与封面主色，不搬它的皮肤。
 * 全站唯一的一级标题由外壳打（「主页」），所以这里从次级标题起。
 */

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

export function HomeView({ onNavigate }: { onNavigate(route: Route): void }) {

  const queue = usePlayer((state) => state.queue)
  const index = usePlayer((state) => state.index)
  const playing = usePlayer((state) => state.playing)
  const position = usePlayer((state) => state.position)

  /*
   * 门卡上要有封面，否则四张卡在暗色里就是四块空灰。
   * 推荐歌单的第一张封面最合适——它本来就是这个页面的门面；
   * 歌单还没加载时退回新歌速递第一首的专辑封面。
   */
  const picksCover = useDiscover(
    (state) =>
      state.blocks.playlists.playlists[0]?.coverUrl ??
      state.blocks.newsongs.songs[0]?.album?.picUrl ??
      null
  )

  const recent = useRecentEntries()
  const today = useToday()

  useEffect(() => {
    void useDiscover.getState().load('playlists').catch(() => {})
  }, [])

  const current = index >= 0 ? (queue[index] ?? null) : null
  /* 没在播的时候，把「上次听到的」当作 hero，避免首屏是一块空白。 */
  const hero = current ?? recent[0]?.track ?? null

  const now = new Date()

  const onHeroPlay = () => {
    if (!hero) return
    if (current) player.toggle()
    else playTrack(hero)
  }

  const recentRows = recent.slice(0, 10)

  return (
    <div className="home">
      <section className="home-hero">
        <div className="home-hero__text">
          <p className="home-hero__kicker">
            {greeting(now)} · {dateText(now)}
          </p>
          <div className="home-hero__title">{hero ? hero.title : '从一首歌开始'}</div>
          {hero ? (
            <p className="home-hero__sub">{[hero.artist, hero.album].filter(Boolean).join(' · ')}</p>
          ) : null}
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
              onClick={() => onNavigate({ view: 'library', tab: 'songs' })}
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
          <Artwork
            src={hero ? artworkFor(hero) : picksCover ? remoteImageUrl(sizedImage(picksCover, 520)) : null}
            alt=""
            fallback={<Note size={38} />}
          />
        </div>
      </section>

      <section className="home-mymusic">
        <div className="home-section-head">
          <h2 className="home-panel__title">我的音乐</h2>
        </div>
        <MyMusic onNavigate={onNavigate} />
      </section>

      <section className="home-picks">
        <div className="home-section-head">
          <h2 className="home-panel__title">为你挑选</h2>
        </div>
        <DiscoverView embedded />
      </section>

      <div className="home-split">
        <section className="home-panel">
          <h2 className="home-panel__title">今日聆听</h2>
          {today.seconds === 0 && today.tracks === 0 ? (
            <p className="home-panel__empty">今天还没有听歌。</p>
          ) : (
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
          )}
        </section>

        
      <section className="home-recent">
        <div className="home-section-head">
          <h2 className="home-panel__title">最近播放</h2>
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
      </div>

      <PlatformLoginDialogs />
    </div>
  )
}
