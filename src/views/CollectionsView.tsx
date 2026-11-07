import { useMemo } from 'react'
import type { ShellRoute } from '../app/shell'
import { artworkFor } from '../features/library/source'
import { useLibrary, groupAlbums, groupArtists } from '../features/library/store'
import { usePlaylists } from '../features/playlists/store'
import { Artwork } from '../ui/Artwork'
import { List, Mic, Note, User } from '../ui/icons'

/**
 * 我的收藏。
 *
 * 一起收三样东西：专辑、歌单、艺人。它们共同点是「我主动留下的」，所以放在
 * 同一页、三块横排——不是三个页签，因为收藏本来就不多，翻页只会多一次点击。
 *
 * 数据现状：本机曲库里有什么就展什么（还没有独立的「收藏专辑」存储），等后端
 * 把收藏关系单独记下来，改的是这三块的取数，版式不用动。
 */
export function CollectionsView({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const tracks = useLibrary((state) => state.tracks)
  const playlists = usePlaylists((state) => state.playlists)

  const albums = useMemo(() => groupAlbums(tracks), [tracks])
  const artists = useMemo(() => groupArtists(tracks), [tracks])

  const none = albums.length === 0 && playlists.length === 0 && artists.length === 0

  if (none) {
    return (
      <div className="pg-empty">
        <h2>还没有收藏</h2>
        <p>添加音乐文件夹之后，这里的专辑、歌单和艺人会自己长出来。</p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'local' })}>
          添加音乐
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      {albums.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>
              <List size={14} /> 专辑
            </h3>
            <span className="rh-more">{albums.length} 张</span>
          </header>
          <div className="rh-row">
            {albums.slice(0, 12).map((album) => (
              <button
                className="rh-card"
                type="button"
                key={album.id}
                onClick={() => onNavigate({ view: 'album', id: album.id })}
              >
                <span className="rh-card__art">
                  <Artwork
                    src={artworkFor(tracks.find((track) => album.trackIds.includes(track.id)) ?? null)}
                    alt=""
                    fallback={<Note size={18} />}
                  />
                </span>
                <span className="rh-card__title">{album.name}</span>
                <span className="rh-card__sub">{album.albumArtist}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {playlists.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>
              <List size={14} /> 歌单
            </h3>
            <span className="rh-more">{playlists.length} 个</span>
          </header>
          <div className="rh-row">
            {playlists.slice(0, 12).map((playlist) => (
              <button
                className="rh-card"
                type="button"
                key={playlist.id}
                onClick={() => onNavigate({ view: 'playlist', id: playlist.id })}
              >
                <span className="rh-card__art rh-card__art--pl">
                  <List size={18} />
                </span>
                <span className="rh-card__title">{playlist.name}</span>
                <span className="rh-card__sub">{playlist.trackIds.length} 首</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {artists.length > 0 ? (
        <section className="rh-sec">
          <header className="rh-sec__head">
            <h3>
              <Mic size={14} /> 艺人
            </h3>
            <span className="rh-more">{artists.length} 位</span>
          </header>
          <div className="rh-row">
            {artists.slice(0, 12).map((artist) => (
              <button
                className="rh-card"
                type="button"
                key={artist.id}
                onClick={() => onNavigate({ view: 'artist', id: artist.id })}
              >
                <span className="rh-card__art rh-card__art--round">
                  <Artwork
                    src={artworkFor(tracks.find((track) => track.albumArtist === artist.name) ?? null)}
                    alt=""
                    fallback={<User size={18} />}
                  />
                </span>
                <span className="rh-card__title">{artist.name}</span>
                <span className="rh-card__sub">
                  {artist.albumIds.length} 张专辑 · {artist.trackCount} 首
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
