import type { ShellRoute } from '../app/shell'
import { useCollectedAlbums } from '../features/online/platform-collections'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlineAlbum } from '../features/refs/navigate'
import { Artwork } from '../ui/Artwork'
import { ArtistById } from '../ui/NameRef'
import { Note } from '../ui/icons'

/**
 * 收藏专辑。
 *
 * 只放平台账号里收藏的专辑。收藏歌单在隔壁「收藏歌单」，自己建的歌单在「我的歌单」，
 * 本机专辑在「本机音乐」——各有各的去处，这一页不重复它们。
 * 平台只是卡片上的一行来源标注，不按平台分段：收藏本来不多，分段只会让人多翻一次。
 */
export function CollectionsPage({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const albums = useCollectedAlbums()

  if (albums.length === 0) {
    return (
      <div className="pg-empty">
        <h2>还没有收藏专辑</h2>
        <p>在平台上收藏的专辑会出现在这里。</p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'home' })}>
          去推荐页看看
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      <section className="rh-sec">
        <header className="rh-sec__head">
          <h3>
            <Note size={14} /> 专辑
          </h3>
          <span className="rh-more">{albums.length} 张</span>
        </header>
        <div className="rh-row">
          {albums.map((album) => (
            <button
              className="rh-card"
              type="button"
              key={album.key}
              onClick={() => openOnlineAlbum(album.providerId, album.id)}
            >
              <span className="rh-card__art" style={{ background: tint(album.key) }}>
                <Artwork
                  src={album.coverUrl ? remoteImageUrl(sizedImage(album.coverUrl, 300), 300) : null}
                  alt=""
                  fallback={<Note size={18} />}
                />
                <span className={'pl-card__src src-dot--' + album.providerId}>{album.providerLabel}</span>
              </span>
              <span className="rh-card__title">{album.name}</span>
              <span className="rh-card__sub">
                {album.providerLabel}
                {album.artistName ? ' · ' : null}
                {album.artistName ? (
                  <ArtistById providerId={album.providerId} id={album.artistId} name={album.artistName} />
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

/**
 * 收藏页的封面底：和首页同一套按 id 取的低饱和渐变。有图时它是图片加载前的
 * 底色，没图时它就是封面本身 —— 两种情况都不该露出壁纸。
 */
function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `linear-gradient(150deg, hsl(${hue} 32% 28% / 0.26), hsl(${(hue + 42) % 360} 28% 14% / 0.34))`
}