import { artworkFor } from '../features/library/source'
import type { Album, Track } from '../types'
import { Artwork } from '../ui/Artwork'
import { formatTime } from '../ui/format'
import { Note, Play, Shuffle } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import { DetailHero } from './DetailHero'

interface AlbumDetailProps {
  album: Album
  /** The album's tracks, already in disc/track order. */
  tracks: Track[]
  currentId: string | null
  playing: boolean
  onPlayAt(index: number): void
  onPlayAll(): void
  onOpenArtist(artistId: string): void
  onMenu?(request: TrackMenuRequest): void
}

/**
 * 一张专辑：封面、谁做的、里面有什么。
 *
 * 点卡片默认进这一页而不是直接播——先看一眼再决定听不听，是所有音乐库的
 * 共同约定，也是「能浏览」和「只能听」的分界。
 */
export function AlbumDetail({
  album,
  tracks,
  currentId,
  playing,
  onPlayAt,
  onPlayAll,
  onOpenArtist,
  onMenu
}: AlbumDetailProps) {
  const first = tracks[0] ?? null
  const total = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
  const formats = [...new Set(tracks.map((track) => track.codec).filter(Boolean))]

  return (
    <div className="col">
      <DetailHero
        art={<Artwork src={artworkFor(first)} alt="" fallback={<Note size={34} />} />}
        kicker="专辑"
        title={album.name}
        meta={
          <>
            <button className="dp__link" type="button" onClick={() => onOpenArtist(album.albumArtist)}>
              {album.albumArtist}
            </button>
            {album.year ? (
              <>
                <span className="sep2">·</span>
                <span>{album.year}</span>
              </>
            ) : null}
            <span className="sep2">·</span>
            <span>{tracks.length} 首</span>
          </>
        }
        actions={
          <>
            <button className="dbtn dbtn--main" type="button" onClick={onPlayAll} disabled={tracks.length === 0}>
              <Play size={15} />
              播放全部
            </button>
            <button
              className="dbtn"
              type="button"
              disabled={tracks.length === 0}
              onClick={() => onPlayAt(Math.floor(Math.random() * tracks.length))}
            >
              <Shuffle size={14} />
              随机
            </button>
          </>
        }
        stats={[
          { value: tracks.length, label: '曲目' },
          { value: total > 0 ? formatTime(total) : '—', label: '时长' },
          { value: formats.length > 0 ? formats.join(' / ') : '—', label: '格式' }
        ]}
      />

      {tracks.length === 0 ? (
        <p className="pg-note">这张专辑没有可播放的曲目。</p>
      ) : (
        <TrackList
          tracks={tracks}
          currentId={currentId}
          playing={playing}
          onPlayAt={onPlayAt}
          onMenu={onMenu}
        />
      )}
    </div>
  )
}
