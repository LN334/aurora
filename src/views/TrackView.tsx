import type { Route } from '../app/routing'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { useLyrics } from '../features/library/hooks'
import { artworkFor } from '../features/library/source'
import { useLibrary } from '../features/library/store'
import { player } from '../features/player/actions'
import { Artwork } from '../ui/Artwork'
import { formatTime } from '../ui/format'
import { Heart, Note, Play, Queue } from '../ui/icons'
import { DetailHero } from './DetailHero'

/** 字节数换成读得懂的大小；只用于本机文件。 */
function sizeLabel(value: number): string | null {
  if (!(value > 0)) return null
  if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB'
  return (value / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * 歌曲详情。
 *
 * 三页分工：详情是「这是什么东西」，正在播放是「现在在听什么」，舞台是「只
 * 听不看别的」。所以这一页不复述播放控制，只回答事实——谁唱的、哪一年、什
 * 么规格、存在哪，歌词当资料列出来，点某一行再交给正在播放去逐行跟随。
 */
export function TrackView({
  id,
  onNavigate,
  onOpenNow
}: {
  id: string
  onNavigate(route: Route): void
  /** 进「正在播放」；带秒数表示从这句歌词开始。 */
  onOpenNow(at?: number): void
}) {
  const track = useLibrary((state) => state.tracks.find((item) => item.id === id) ?? null)
  const likedIds = useLikedIds()
  const { lyrics } = useLyrics(track)
  const liked = track ? likedIds.has(track.id) : false

  if (!track) {
    return (
      <div className="empty">
        <h2>这首歌不在本机曲库</h2>
        <button className="btn btn--accent" onClick={() => onNavigate({ view: 'library', tab: 'songs' })}>
          回本机音乐
        </button>
      </div>
    )
  }

  const art = artworkFor(track)
  const origin = track.source && track.source !== 'local' ? track.source : '本机'
  const quality = [track.codec, track.sampleRate ? Math.round(track.sampleRate / 1000) + 'kHz' : null]
    .filter(Boolean)
    .join(' · ')
  const bytes = sizeLabel(track.size)

  return (
    <div className="col tk">
      <DetailHero
        art={
          <button
            type="button"
            className="tk__art"
            onClick={() => onOpenNow()}
            title="去正在播放"
            aria-label="去正在播放"
          >
            <Artwork src={art} fallback={<Note size={34} />} />
            <span className="tk__art-hint">正在播放</span>
          </button>
        }
        kicker={origin + ' · 歌曲'}
        title={track.title}
        meta={
          <>
            {track.artist ? <span>{track.artist}</span> : null}
            {track.album ? <span>{track.album}</span> : null}
            {track.year ? <span>{track.year}</span> : null}
            {track.duration > 0 ? <span>{formatTime(track.duration)}</span> : null}
            {quality ? <span>{quality}</span> : null}
            {track.lossless ? <span>无损</span> : null}
          </>
        }
        actions={
          <>
            <button
              className="rh-btn rh-btn--main"
              type="button"
              onClick={() => player.playTrack(track)}
            >
              <Play size={15} />
              播放
            </button>
            <button
              className={`rh-btn${liked ? ' is-on' : ''}`}
              type="button"
              onClick={() => void toggleLiked(track)}
              aria-pressed={liked}
            >
              <Heart size={15} />
              {liked ? '已喜欢' : '喜欢'}
            </button>
            <button className="rh-btn" type="button" onClick={() => player.addToQueue([track], 'next')}>
              <Queue size={14} />
              下一首播放
            </button>
          </>
        }
      />

      <div className="tk__body">
        <section className="tk__main">
          <header className="rh-sec__head">
            <h3>歌词</h3>
          </header>
          {lyrics.lines.length > 0 ? (
            <div className="tk__lyrics">
              {lyrics.lines.map((line, index) => (
                <button
                  key={index}
                  type="button"
                  className="tk__line"
                  onClick={() => onOpenNow(Math.max(0, line.time))}
                >
                  {line.text || '·'}
                </button>
              ))}
            </div>
          ) : (
            <p className="pg-note">这首歌没有歌词。</p>
          )}
        </section>

        <aside className="tk__side">
          <header className="rh-sec__head">
            <h3>这首歌</h3>
          </header>
          <dl className="tk__facts">
            <dt>来源</dt>
            <dd>{origin}</dd>
            <dt>专辑</dt>
            <dd>{track.album || '未知'}</dd>
            <dt>艺人</dt>
            <dd>{track.artist || '未知'}</dd>
            {track.year ? (
              <>
                <dt>年份</dt>
                <dd>{track.year}</dd>
              </>
            ) : null}
            <dt>时长</dt>
            <dd>{track.duration > 0 ? formatTime(track.duration) : '未知'}</dd>
            {quality ? (
              <>
                <dt>音质</dt>
                <dd>{quality}{track.lossless ? ' · 无损' : ''}</dd>
              </>
            ) : null}
            {bytes ? (
              <>
                <dt>大小</dt>
                <dd>{bytes}</dd>
              </>
            ) : null}
            {track.path ? (
              <>
                <dt>路径</dt>
                <dd className="tk__path">{track.path}</dd>
              </>
            ) : null}
          </dl>
        </aside>
      </div>
    </div>
  )
}
