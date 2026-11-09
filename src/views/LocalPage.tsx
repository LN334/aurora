import { useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { artworkFor } from '../features/library/source'
import { groupAlbums, groupArtists, useLibrary } from '../features/library/store'
import { buildFolderTree } from '../features/library/tree'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { Artwork } from '../ui/Artwork'
import { formatSpan } from '../ui/format'
import { Folder, Note, User } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'
import { FolderTree } from './FolderTree'

type Tab = 'songs' | 'albums' | 'artists' | 'folders'

const TABS: Array<[Tab, string]> = [
  ['songs', '歌曲'],
  ['albums', '专辑'],
  ['artists', '艺人'],
  ['folders', '文件夹']
]

/**
 * 本机音乐：磁盘上那些文件。
 *
 * 四类（歌曲 / 专辑 / 艺人 / 文件夹）是同一个集合的四种看法，所以它们是这一页
 * 里的四个页签，而不是左栏的四个入口——左栏只解决「去哪个来源」，不解决
 * 「按什么看」。文件夹只在这一页存在，在线来源没有这个概念。
 */
export function LocalPage({
  onNavigate,
  onMenu,
  initialTab
}: {
  onNavigate(route: ShellRoute): void
  onMenu(request: TrackMenuRequest): void
  initialTab?: Tab
}) {
  const tracks = useLibrary((state) => state.tracks)
  const roots = useLibrary((state) => state.roots)
  const scanning = useLibrary((state) => state.scanning)
  const [tab, setTab] = useState<Tab>(initialTab ?? 'songs')

  const albums = useMemo(() => groupAlbums(tracks), [tracks])
  const artists = useMemo(() => groupArtists(tracks), [tracks])
  const seconds = useMemo(() => tracks.reduce((sum, track) => sum + (track.duration || 0), 0), [tracks])
  const currentId = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index]?.id ?? null) : null))
  const playing = usePlayer((state) => state.playing)

  /** 与「音乐库」同一棵树：两页看同一批文件，不该有两种目录形状。 */
  const folderTree = useMemo(() => buildFolderTree(tracks), [tracks])

  const currentFolder = useMemo(() => {
    const current = tracks.find((track) => track.id === currentId) ?? null
    return current ? current.path.replace(/[\\/][^\\/]*$/, '') : null
  }, [tracks, currentId])

  const playFolder = (path: string) => {
    const inside = tracks.filter((track) => track.path.startsWith(path))
    if (inside.length > 0) player.playQueue(inside, 0)
  }

  if (tracks.length === 0 && !scanning) {
    return (
      <div className="empty">
        <h2>还没有本机音乐</h2>
        <button className="btn btn--accent" type="button" onClick={() => onNavigate({ view: 'sources' })}>
          添加音乐文件夹
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      <header className="rh-sec__head lm-head">
        <div className="lm-tabs" role="tablist" aria-label="本机音乐的看法">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className={'chip' + (tab === key ? ' is-active' : '')}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="pl-head__count lm-count">
          {tracks.length} 首 · {albums.length} 张专辑 · {artists.length} 位艺人 ·{' '}
          {formatSpan(seconds)}
        </span>
      </header>

      {tab === 'songs' ? (
        <TrackList
          tracks={tracks}
          currentId={currentId}
          playing={playing}
          onPlayAt={(index) => player.playQueue(tracks, index)}
          onMenu={onMenu}
        />
      ) : null}

      {tab === 'albums' ? (
        <div className="rh-row">
          {albums.map((album) => {
            const first = tracks.find((track) => album.trackIds.includes(track.id)) ?? null
            return (
            <button
              className="rh-card"
              type="button"
              key={album.id}
              onClick={() => onNavigate({ view: 'album', id: album.id })}
            >
              <span className="rh-card__art">
                <Artwork src={artworkFor(first)} alt="" fallback={<Note size={18} />} />
              </span>
              <span className="rh-card__title">{album.name}</span>
              <span className="rh-card__sub">
                {album.albumArtist}
                {album.year ? ' · ' + album.year : ''}
              </span>
            </button>
            )
          })}
        </div>
      ) : null}

      {tab === 'artists' ? (
        <div className="rh-row">
          {artists.map((artist) => {
            const first = tracks.find((track) => track.albumArtist === artist.name) ?? null
            return (
              <button
                className="rh-card"
                type="button"
                key={artist.id}
                onClick={() => onNavigate({ view: 'artist', id: artist.id })}
              >
                <span className="rh-card__art rh-card__art--round">
                  <Artwork src={artworkFor(first)} alt="" fallback={<User size={18} />} />
                </span>
                <span className="rh-card__title">{artist.name}</span>
                <span className="rh-card__sub">
                  {artist.albumIds.length} 张专辑 · {artist.trackCount} 首
                </span>
              </button>
            )
          })}
        </div>
      ) : null}

      {tab === 'folders' ? (
        <div className="lm-folders">
          {/* 监听中的文件夹只是一行状态，不是这一页的主体：主体是下面那棵树。
              以前这里把「我监听了哪些目录」当成文件夹页的全部内容，于是曲库
              有 27 首歌却报「还没有监听任何文件夹」——两句话互相打脸。 */}
          {roots.length > 0 ? (
            <div className="lm-roots">
              {roots.map((root) => {
                const under = tracks.filter((track) => track.path.startsWith(root))
                return (
                  <button
                    className="lm-root"
                    type="button"
                    key={root}
                    title={'管理 ' + root}
                    onClick={() => onNavigate({ view: 'sources' })}
                  >
                    <Folder size={14} />
                    <span className="lm-root__name">{root.split(/[\\/]/).pop() || root}</span>
                    <span className="lm-root__meta">{under.length} 首</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="lm-hint">
              这 {tracks.length} 首是手动加进来的，没有记下文件夹。右上角加一个文件夹之后，磁盘里增删的歌会跟着变。
            </p>
          )}

          <FolderTree nodes={folderTree} currentFolder={currentFolder} onPlay={playFolder} />
        </div>
      ) : null}
    </div>
  )
}
