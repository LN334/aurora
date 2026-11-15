import type { ShellRoute } from '../app/shell'
import { useCollectedAlbums, useSignedInPlatforms } from '../features/online/platform-collections'
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
  const signed = useSignedInPlatforms()

  /*
   * 空页要说清是哪一种空。
   *
   * 「还没有收藏专辑」在三种情况下都是同一句话：没登录、登录过期、真的没收藏。
   * 前两种用户其实什么都没做错，只说「还没有」等于把问题丢回给他——所以按登录
   * 状态分开说，并给出下一步该点哪里。
   */
  if (albums.length === 0) {
    const anySigned = Boolean(signed?.netease || signed?.qq)
    return (
      <div className="pg-empty">
        <h2>{anySigned ? '没读到收藏的专辑' : '还没有登录平台'}</h2>
        <p>
          {anySigned
            ? '如果确实在网易云或 QQ 收藏过专辑，可能是登录过期了，重新登录一次就会回来。'
            : '收藏的专辑存在平台账号里，登录网易云或 QQ 之后这里才有东西可看。'}
        </p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'me' })}>
          {anySigned ? '去重新登录' : '去登录'}
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
              onClick={(event) => openOnlineAlbum(album.providerId, album.id, event.currentTarget)}
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