import { usePlayer } from '../features/player/store'
import { player } from '../features/player/actions'
import { useRoam } from '../features/player/roam-session'
import { trackKey } from '../features/online/unify'
import { RoamRail } from './RoamRail'
import type { Lyrics } from '../features/lyrics/lrc'
import { activeLineAt } from '../features/lyrics/lrc'
import { useProgressPosition } from '../features/player/Bar'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { artworkFor } from '../features/library/source'
import { Artwork } from '../ui/Artwork'
import { formatTime } from '../ui/format'
import { AlbumName, ArtistName } from '../ui/NameRef'
import type { Track } from '../types'
import {
  ChevronLeft,
  Heart,
  Next,
  Note,
  Pause,
  Play,
  Prev,
  Repeat,
  RepeatOne,
  Shuffle,
  Volume,
  VolumeMute
} from '../ui/icons'

/**
 * 行高必须和 CSS 里 .np__line 的高度一致：歌词靠 translateY 精确居中，
 * 而不是靠 scrollTop —— 后者在换歌、跳行、窗口缩放时会抖一下。
 */
const LINE_H = 44

interface NowPlayingProps {
  track: Track | null
  lyrics: Lyrics
  duration: number
  playing: boolean
  onBack(): void
  onSeek(seconds: number): void
  onSeekRatio(ratio: number): void
  onOpenStage(): void
}

/**
 * 正在播放。
 *
 * 这页和「歌曲详情」「舞台」是三件不同的事，别合并：
 *
 * - 歌曲详情回答「这首歌是什么」：谁唱的、什么专辑、哪个文件、我喜欢过没有。
 * - 这一页回答「现在正听到哪」：封面、歌词跟着走、想跳哪一句跳哪一句。
 * - 舞台是全屏沉浸，把外壳整个让出去。
 *
 * 所以这一页留着外壳（左栏、播放条都在），只是把中间那块换成封面加歌词。
 */
export function NowPlaying({
  track,
  lyrics,
  duration,
  playing,
  onBack,
  onSeek,
  onSeekRatio,
  onOpenStage
}: NowPlayingProps) {
  const likedIds = useLikedIds()
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const shuffle = usePlayer((state) => state.shuffle)
  const repeat = usePlayer((state) => state.repeat)
  const liked = track ? likedIds.has(track.id) : false
  /*
   * 这一首在不在当前这趟漫游里。用 trackKey 对而不是对象引用：队列里可能放的是
   * 合并前的另一份同名曲，引用不同、其实是同一首。
   */
  const roamTracks = useRoam((state) => state.tracks)
  const roam = Boolean(
    track && roamTracks.some((item) => trackKey(item) === trackKey(track))
  )
  // 队列里的下一首：底部那片空白里放一句「接下来」，比空着有用。
  const upcoming = usePlayer((state) => {
    if (state.queue.length === 0) return null
    const next = state.index + 1
    if (next >= state.queue.length) return state.repeat === 'all' ? (state.queue[0] ?? null) : null
    return state.queue[next] ?? null
  })

  // 只订阅「第几行」而不是 position：进度每秒跳六十次，这个值一首歌只变几十次。
  const active = usePlayer((state) => (lyrics.lines.length > 0 ? activeLineAt(lyrics.lines, state.position) : -1))
  const anchor = active < 0 ? 0 : active

  if (!track) {
    return (
      <div className="np np--empty">
        <button type="button" className="np__back" onClick={onBack} aria-label="返回">
          <ChevronLeft size={19} />
        </button>
        <div className="np__nothing">
          <Note size={30} />
          <p>还没有在播放</p>
          <span>从推荐里挑一首，或者去本机音乐里放一张专辑。</span>
        </div>
      </div>
    )
  }

  const art = artworkFor(track)
  const origin = track.source && track.source !== 'local' ? track.source : '本机'

  return (
    <div className="np">

      <div className="np__grid">
        <div className="np__left">
          <button
            type="button"
            className="np__cover"
            onClick={onOpenStage}
            title="进舞台"
            aria-label="进舞台"
          >
            <Artwork src={art} fallback={<Note size={64} />} />
            <span className="np__cover-hint">舞台</span>
          </button>

          <div className="np__meta">
            <h1 className="np__title" title={track.title}>
              {track.title}
            </h1>
            <div className="np__sub">
              <span className="np__badge">{origin}</span>
              <ArtistName track={track} text={track.artist || '未知艺人'} />
              {track.album ? <span className="np__dot">·</span> : null}
              {track.album ? (
                <span className="np__album">
                  <AlbumName track={track} />
                </span>
              ) : null}
            </div>
          </div>

          <div className="np__acts">
            <button
              type="button"
              className={`np__like${liked ? ' is-on' : ''}`}
              onClick={() => void toggleLiked(track)}
              aria-pressed={liked}
              title={liked ? '取消喜欢' : '喜欢'}
            >
              <Heart size={18} />
            </button>
            <button
              type="button"
              className={`np__shuf${shuffle ? ' is-on' : ''}`}
              onClick={() => player.toggleShuffle()}
              title="随机播放"
              aria-pressed={shuffle}
            >
              <Shuffle size={17} />
            </button>
            <button type="button" className="np__step" onClick={() => player.prev()} title="上一首">
              <Prev size={20} />
            </button>
            <button
              type="button"
              className="np__play"
              onClick={() => player.toggle()}
              title={playing ? '暂停' : '播放'}
            >
              {playing ? <Pause size={24} /> : <Play size={24} />}
            </button>
            <button type="button" className="np__step" onClick={() => player.next()} title="下一首">
              <Next size={20} />
            </button>
            <button
              type="button"
              className={`np__rep${repeat !== 'off' ? ' is-on' : ''}`}
              onClick={() => player.cycleRepeat()}
              title={repeat === 'one' ? '单曲循环' : repeat === 'all' ? '列表循环' : '不循环'}
            >
              {repeat === 'one' ? <RepeatOne size={17} /> : <Repeat size={17} />}
            </button>
            <button type="button" className="np__vol" onClick={() => player.toggleMute()} title={muted ? '取消静音' : '静音'}>
              {muted || volume === 0 ? <VolumeMute size={17} /> : <Volume size={17} />}
            </button>
          </div>
        </div>

        <div className="np__right">
          {lyrics.lines.length > 0 ? (
            <div className="np__lyr-window">
              <div
                className="np__lyr"
                style={{ transform: `translateY(${-(anchor * LINE_H + LINE_H / 2)}px)` }}
              >
                {lyrics.lines.map((line, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`np__line${index === active ? ' is-active' : ''}`}
                    onClick={() => onSeek(line.time)}
                    title={formatTime(line.time)}
                  >
                    <span>{line.text || '·'}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="np__nolyrics">
              <Note size={22} />
              这首歌还没有歌词
            </div>
          )}
        </div>
      </div>

      {roam ? <RoamRail /> : null}

      <footer className="np__foot">
        {roam ? null : (
        <div className="np__next">
          {upcoming ? (
            <>
              <span className="np__next-k">接下来</span>
              <span className="np__next-t" title={upcoming.title}>
                {upcoming.title}
              </span>
              <span className="np__next-a"><ArtistName track={upcoming} /></span>
            </>
          ) : (
            <span className="np__next-k">队列里没有下一首了</span>
          )}
        </div>
        )}
        <NpProgress duration={duration} onSeekRatio={onSeekRatio} />
      </footer>
    </div>
  )
}

/** 进度条：订阅量化后的位置，所以它每秒只重渲染八次。 */
function NpProgress({ duration, onSeekRatio }: { duration: number; onSeekRatio(ratio: number): void }) {
  const position = useProgressPosition()
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0

  return (
    <div className="np__progress">
      <span className="np__time">{formatTime(position)}</span>
      <div
        className="np__track"
        role="slider"
        tabIndex={0}
        aria-label="播放进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          if (rect.width > 0) onSeekRatio((event.clientX - rect.left) / rect.width)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') onSeekRatio(Math.min(1, ratio + 0.02))
          else if (event.key === 'ArrowLeft') onSeekRatio(Math.max(0, ratio - 0.02))
        }}
      >
        <div className="np__track-fill" style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="np__time">{formatTime(duration)}</span>
    </div>
  )
}
