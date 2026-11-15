import type { ShellRoute } from '../app/shell'
import { anySourceSigned, useFollowedArtists, useSignedInPlatforms } from '../features/online/platform-collections'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlineArtist } from '../features/refs/navigate'
import { Artwork } from '../ui/Artwork'
import { User } from '../ui/icons'

/**
 * 关注的艺人。
 *
 * 这一页是平台账号里的关系，不是本机曲库：本机那些艺术家在「本机音乐」的艺人
 * 标签里，两件事不该挤在一个入口。
 *
 * 网易云与 QQ 都有「关注歌手」这条通道，酷狗与汽水没有这种关系。卡片不按平台
 * 分段，一行字说明来源就够了。
 */
export function FollowedArtistsPage({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const artists = useFollowedArtists()
  const signed = useSignedInPlatforms()

  /*
   * 空页要说清是哪一种空。
   *
   * 「登录了没有」看所有有这条通道的平台（网易云与 QQ）；都登录了却仍然空，多半
   * 是会话过期（文件还在、能解密，服务端却已经不认了），这时只说「还没有关注」
   * 等于把问题推回给用户。
   *
   * 但文案里不点名平台——用户看到的是「关注艺人」这一页，不是「某家关注艺人」。
   */
  if (artists.length === 0) {
    const anySigned = anySourceSigned('followedArtists', signed)
    return (
      <div className="pg-empty">
        <h2>{anySigned ? '没读到关注的艺人' : '还没有登录'}</h2>
        <p>
          {anySigned
            ? '如果在平台上关注过艺人，可能是登录过期了，重新登录一次就会回来。'
            : '关注的艺人存在平台账号里，登录之后这里才有东西可看。'}
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
            <User size={14} /> 艺人
          </h3>
          <span className="rh-more">{artists.length} 位</span>
        </header>
        <div className="rh-row">
          {artists.map((artist) => (
            <button
              className="rh-card"
              type="button"
              key={artist.key}
              onClick={(event) => openOnlineArtist(artist.providerId, artist.id, event.currentTarget)}
            >
              <span className="rh-card__art rh-card__art--round" style={{ background: tint(artist.key) }}>
                <Artwork
                  src={artist.avatarUrl ? remoteImageUrl(sizedImage(artist.avatarUrl, 300), 300) : null}
                  alt=""
                  fallback={<User size={18} />}
                />
              </span>
              <span className="rh-card__title">{artist.name}</span>
              <span className="rh-card__sub">{subtitle(artist)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

/**
 * 卡片副标题。
 *
 * 上游给计数就照写；一点计数都没有（酷狗的歌手行只给 id 与名字）时说清是哪一家，
 * 而不是写「还没有专辑」——那是我们没拿到这两个数，不是他真的一张都没有。
 */
function subtitle(artist: {
  albumCount?: number
  musicCount?: number
  providerLabel: string
}): string {
  const parts: string[] = []
  if (artist.albumCount !== undefined) {
    parts.push(artist.albumCount > 0 ? artist.albumCount + ' 张专辑' : '还没有专辑')
  }
  if (artist.musicCount) parts.push(artist.musicCount + ' 首歌')
  return parts.length > 0 ? parts.join(' · ') : artist.providerLabel
}

/**
 * 头像底：和收藏专辑页同一套按 id 取的低饱和渐变。有图时是加载前的底色，
 * 没图时它就是头像本身——两种情况都不该露出壁纸。
 */
function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `linear-gradient(150deg, hsl(${hue} 32% 28% / 0.26), hsl(${(hue + 42) % 360} 28% 14% / 0.34))`
}