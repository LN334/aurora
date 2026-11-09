import { useMemo } from 'react'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { useLyrics } from '../features/library/hooks'
import { artworkFor } from '../features/library/source'
import { splitLyricLine } from '../features/lyrics/line-parts'
import { findSeenTrack } from '../features/library/seen'
import { useLibrary } from '../features/library/store'
import { useRecentEntries } from '../features/player/history-store'
import { player } from '../features/player/actions'
import { openOnlineAlbum, openOnlineArtist, refOfTrack } from '../features/refs/navigate'
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
  onOpenLocal,
  onOpenNow
}: {
  id: string
  /** 回「本机音乐」——空态里那句「去音乐库」原来的落点。 */
  onOpenLocal(): void
  /** 进「正在播放」；带秒数表示从这句歌词开始。 */
  onOpenNow(at?: number): void
}) {
  /*
   * 详情页从任何一页都进得来，所以不能只翻本机库：在线歌点「歌曲详情」以前会
   * 落到「这首歌不在本机曲库」——那不是用户的错，是这里只查了一张表。现在的
   * 顺序是本机库 → 刚才任意列表里渲染过的（见 features/library/seen）→ 最近
   * 听过，三处都没有才算真没有。
   */
  const inLibrary = useLibrary((state) => state.tracks.find((item) => item.id === id) ?? null)
  const recent = useRecentEntries()
  const track = useMemo(
    () => inLibrary ?? findSeenTrack(id) ?? recent.find((entry) => entry.track?.id === id)?.track ?? null,
    [inLibrary, recent, id]
  )
  const likedIds = useLikedIds()
  const { lyrics } = useLyrics(track)
  const liked = track ? likedIds.has(track.id) : false

  if (!track) {
    return (
      <div className="empty">
        <h2>找不到这首歌</h2>
        <button className="btn btn--accent" onClick={onOpenLocal}>
          回本机音乐
        </button>
      </div>
    )
  }

  const art = artworkFor(track)
  const origin = track.source && track.source !== 'local' ? track.source : '本机'
  /*
   * 艺人 / 专辑在页头是能点的。判断「能不能点」交给 refOfTrack：只有当这一行带着
   * 那一家的 id、且那一家真的做了那一页时才给按钮，否则留纯文字。别在这里按平台
   * 名字写死——那样换一家就得回来改一次。
   */
  const refs = refOfTrack(track)
  const source = track.source ?? ''
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
            {track.artist ? (
              refs.artist ? (
                <button
                  className="dp__link"
                  type="button"
                  onClick={() => openOnlineArtist(source, refs.artist as number)}
                  title={`去 ${track.artist} 的页面`}
                >
                  {track.artist}
                </button>
              ) : (
                <span>{track.artist}</span>
              )
            ) : null}
            {track.album ? (
              refs.album ? (
                <button
                  className="dp__link"
                  type="button"
                  onClick={() => openOnlineAlbum(source, refs.album as number)}
                  title={`去《${track.album}》`}
                >
                  {track.album}
                </button>
              ) : (
                <span>{track.album}</span>
              )
            ) : null}
            {track.year ? <span>{track.year}</span> : null}
            {track.duration > 0 ? <span>{formatTime(track.duration)}</span> : null}
            {quality ? <span>{quality}</span> : null}
            {track.lossless ? <span>无损</span> : null}
          </>
        }
        actions={
          <>
            <button
              className="dbtn dbtn--main"
              type="button"
              onClick={() => player.playTrack(track)}
            >
              <Play size={15} />
              播放
            </button>
            <button
              className={`dbtn${liked ? ' is-on' : ''}`}
              type="button"
              onClick={() => void toggleLiked(track)}
              aria-pressed={liked}
            >
              <Heart size={15} />
              {liked ? '已喜欢' : '喜欢'}
            </button>
            <button className="dbtn" type="button" onClick={() => player.addToQueue([track], 'next')}>
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
              {lyrics.lines.map((line, index) => {
                const parts = splitLyricLine(line.text)
                return (
                  <button
                    key={index}
                    type="button"
                    className="tk__line"
                    onClick={() => onOpenNow(Math.max(0, line.time))}
                  >
                    <span className="tk__main">{parts.main || '·'}</span>
                    {parts.sub ? <span className="tk__sub">{parts.sub}</span> : null}
                  </button>
                )
              })}
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
            <dd>
              {refs.album && track.album ? (
                <button
                  className="dp__link"
                  type="button"
                  onClick={() => openOnlineAlbum(source, refs.album as number)}
                >
                  {track.album}
                </button>
              ) : (
                track.album || '未知'
              )}
            </dd>
            <dt>艺人</dt>
            <dd>
              {refs.artist && track.artist ? (
                <button
                  className="dp__link"
                  type="button"
                  onClick={() => openOnlineArtist(source, refs.artist as number)}
                >
                  {track.artist}
                </button>
              ) : (
                track.artist || '未知'
              )}
            </dd>
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
