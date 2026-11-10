import type { ShellRoute } from '../app/shell'
import { useFollowedArtists } from '../features/online/platform-collections'
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
 * 目前只有网易云有「关注歌手」这条通道——QQ 音乐没有对应接口，酷狗与汽水也
 * 没有这种关系。所以卡片不按平台分段，一行字说明来源就够了。
 */
export function FollowedArtistsPage({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const artists = useFollowedArtists()

  if (artists.length === 0) {
    return (
      <div className="pg-empty">
        <h2>还没有关注艺人</h2>
        <p>在网易云音乐关注的艺人会出现在这里。</p>
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
              onClick={() => openOnlineArtist('netease', artist.id)}
            >
              <span className="rh-card__art rh-card__art--round" style={{ background: tint(artist.key) }}>
                <Artwork
                  src={artist.avatarUrl ? remoteImageUrl(sizedImage(artist.avatarUrl, 300), 300) : null}
                  alt=""
                  fallback={<User size={18} />}
                />
              </span>
              <span className="rh-card__title">{artist.name}</span>
              <span className="rh-card__sub">
                {artist.albumCount ? artist.albumCount + ' 张专辑' : '还没有专辑'}
                {artist.musicCount ? ' · ' + artist.musicCount + ' 首歌' : ''}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
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