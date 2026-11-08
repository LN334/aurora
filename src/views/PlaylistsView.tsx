import { useMemo } from 'react'
import type { ShellRoute } from '../app/shell'
import { collectedOnly, useAccountPlaylists } from '../features/online/playlist-cards'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlinePlaylist } from '../features/refs/navigate'
import { Note } from '../ui/icons'

/**
 * 收藏的歌单：从别人那里收来的那些。
 *
 * 自己建的在隔壁「我的歌单」。这两样以前挤在同一张网里，新建入口也在那张网
 * 中间，于是「收藏」这页既放别人的东西又放自己的东西——名字和内容对不上。现在
 * 这页只读：没有任何新建入口，也没有本地歌单。
 *
 * 平台只是卡片上的一行来源标注，不按平台分段：收藏本来就不多，分段只会让人多
 * 翻一次。
 */
export function PlaylistsView({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const cards = useAccountPlaylists()
  const collected = useMemo(() => collectedOnly(cards), [cards])
  // 分不出归属的那些单独说一句，免得用户以为这页把自己建的也算成收藏了。
  const mixed = useMemo(() => collected.some((row) => row.ownership === 'unknown'), [collected])

  if (collected.length === 0) {
    return (
      <div className="pg-empty">
        <h2>还没有收藏的歌单</h2>
        <p>在平台账号里收藏别人的歌单，它们会出现在这里。自己建的歌单在左边的「我的歌单」。</p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'home' })}>
          去推荐页看看
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      <div className="pl-grid">
        {collected.map((row) => (
          <button
            className="rh-card pl-card"
            type="button"
            key={row.key}
            onClick={() => openOnlinePlaylist(row.providerId, row)}
          >
            <span className="rh-card__art" style={{ background: tint(row.key) }}>
              {/* 封面走主进程代理：页面 CSP 不允许外域图片，原地址由 aurora-remote:// 转发。 */}
              {row.coverUrl ? (
                <img src={remoteImageUrl(sizedImage(row.coverUrl, 300))} alt="" loading="lazy" />
              ) : (
                <Note size={20} />
              )}
              <span className={'pl-card__src src-dot--' + row.providerId}>{row.providerLabel}</span>
            </span>
            <span className="rh-card__title">{row.name}</span>
            <span className="rh-card__sub">
              {row.trackCount > 0 ? row.trackCount + ' 首' : row.providerLabel}
              {row.creator ? ' · ' + row.creator : ''}
            </span>
          </button>
        ))}
      </div>

      {mixed ? (
        <p className="pg-note">
          QQ 音乐、酷狗、汽水的账号歌单接口分不出「自己建的」和「收藏的」，这里一并列出；网易云能分，所以它的自建歌单在「我的歌单」里。
        </p>
      ) : null}
    </div>
  )
}

function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return 'linear-gradient(150deg, hsl(' + (h % 360) + ' 30% 26% / 0.4), hsl(' + ((h + 40) % 360) + ' 26% 13% / 0.5))'
}
