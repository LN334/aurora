import { artworkFor } from '../features/library/source'
import type { Album, Artist, Track } from '../types'
import { Artwork } from '../ui/Artwork'
import { formatSpan } from '../ui/format'
import { Note, Play, User } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import { DetailHero } from './DetailHero'

/**
 * 一位艺人：头像、两个数字、他唱得最多的那几首、他出过的专辑。
 *
 * 之前点艺人只是把那一行点亮，没有「这一位」的页面。艺人在音乐库里是一个真正
 * 的落点——一个人听过某位十张专辑之后，会想从人这一侧再看一次自己的库。
 */
export function ArtistPage({
  artist,
  albums,
  tracks,
  currentId,
  playing,
  onPlayAt,
  onOpenAlbum,
  onMenu
}: {
  artist: Artist
  albums: Album[]
  tracks: Track[]
  currentId: string | null
  playing: boolean
  onPlayAt(index: number): void
  onOpenAlbum(albumId: string): void
  onMenu?(request: TrackMenuRequest): void
}) {
  const portrait = tracks[0] ?? null
  const total = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)

  return (
    <div className="col">
      <DetailHero
        art={<Artwork src={artworkFor(portrait)} alt="" fallback={<User size={34} />} />}
        round
        kicker="艺人"
        title={artist.name}
        meta={
          <span>
            {artist.albumIds.length} 张专辑 · {artist.trackCount} 首
          </span>
        }
        actions={
          <button
            className="dbtn dbtn--main"
            type="button"
            disabled={tracks.length === 0}
            onClick={() => onPlayAt(0)}
          >
            <Play size={15} />
            播放全部
          </button>
        }
        stats={[
          { value: artist.trackCount, label: '曲目' },
          { value: artist.albumIds.length, label: '专辑' },
          { value: total > 0 ? formatSpan(total) : '—', label: '时长' }
        ]}
      />

      {tracks.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>歌曲</h3>
            <span className="rh-more">{tracks.length} 首</span>
          </header>
          <TrackList
            tracks={tracks}
            currentId={currentId}
            playing={playing}
            onPlayAt={onPlayAt}
            onMenu={onMenu}
          />
        </section>
      ) : null}

      {albums.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>专辑</h3>
            <span className="rh-more">{albums.length} 张</span>
          </header>
          <div className="rh-row">
            {albums.map((item) => (
              <button className="rh-card" type="button" key={item.id} onClick={() => onOpenAlbum(item.id)}>
                <span className="rh-card__art">
                  <Artwork
                    src={artworkFor(tracks.find((t) => item.trackIds.includes(t.id)) ?? null)}
                    alt=""
                    fallback={<Note size={20} />}
                  />
                </span>
                <span className="rh-card__title">{item.name}</span>
                <span className="rh-card__sub">
                  {item.year ? item.year + ' · ' : ''}
                  {item.trackIds.length} 首
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
