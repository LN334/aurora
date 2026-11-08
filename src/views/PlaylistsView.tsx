import { useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { PLAYLIST_PROVIDERS, useAccountPlaylists, type PlaylistCard } from '../features/online/playlist-cards'
import { getProvider } from '../features/online/registry'
import { useOnlineStore } from '../features/online/store'
import type { ProviderId } from '../features/online/types'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlinePlaylist } from '../features/refs/navigate'
import { Note, Plus } from '../ui/icons'
import { NameModal } from './NameModal'

/**
 * 歌单：按平台分组，一页看完几个账号里的单子。
 *
 * 不分「我建的」和「收藏的」。那个分法看着像在讲归属，实际是在讲数据是从哪个
 * 接口拿的——用户脑子里那件事是「网易云有哪些、QQ 有哪些」，不是「谁建的」。
 * 组里也不排序：平台给什么顺序就是什么顺序，自建与收藏本来就常常混在一起。
 *
 * 新建只出现在能写歌单的平台（现在只有网易云）。点了就把歌建到那个平台的账号
 * 上，Aurora 自己不存歌单——所以换台机器登录同一个账号，单子还在。
 */
export function PlaylistsView({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const { cards, loading } = useAccountPlaylists()
  const netease = useOnlineStore('netease')()
  const qq = useOnlineStore('qq')()
  const kugou = useOnlineStore('kugou')()
  const qishui = useOnlineStore('qishui')()
  const [naming, setNaming] = useState<ProviderId | null>(null)

  const signedIn: Record<string, boolean> = {
    netease: Boolean(netease.account),
    qq: Boolean(qq.account),
    kugou: Boolean(kugou.account),
    qishui: Boolean(qishui.account)
  }

  const groups = useMemo(() => {
    return PLAYLIST_PROVIDERS.map((platform) => ({
      ...platform,
      rows: cards.filter((card) => card.providerId === platform.id),
      writable: Boolean(getProvider(platform.id)?.playlists?.create)
    })).filter((group) => group.rows.length > 0 || signedIn[group.id])
  }, [cards, signedIn.netease, signedIn.qq, signedIn.kugou, signedIn.qishui])

  const create = async (name: string) => {
    const providerId = naming
    setNaming(null)
    if (!providerId) return
    const provider = getProvider(providerId)
    const made = await provider?.playlists?.create?.(name)
    if (!made) return
    await useOnlineStore(providerId).getState().loadPlaylists()
    openOnlinePlaylist(providerId, { ...made, coverUrl: null })
  }

  /*
   * 读歌单要跑四个平台的接口，先到的先画。空着等的那一刻最难看：页面白一下，
   * 然后几十张卡同时砸下来。这里先按同样的网格铺一层占位，卡到一张填一张。
   */
  if (loading && cards.length === 0) {
    return (
      <div className="col">
        <div className="pl-grid" aria-hidden="true">
          {Array.from({ length: 12 }, (_, at) => (
            <div className="rh-card pl-card is-sk" key={'sk-pl-' + at}>
              <span className="rh-card__art" style={{ background: tint('sk-pl-' + at) }} />
              <span className="rh-card__title">{'\u00A0'}</span>
              <span className="rh-card__sub">{'\u00A0'}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="pg-empty">
        <h2>还没有歌单</h2>
        <p>歌单都在平台账号里。去「我」登录一个平台，那边的歌单就会出现在这里。</p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'me' })}>
          去登录
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      {groups.map((group) => (
        <section className="rh-sec" key={group.id}>
          <header className="rh-sec__head">
            <h3>{group.label}</h3>
            <span className="rh-more">{group.rows.length} 个</span>
            {group.writable && signedIn[group.id] ? (
              <button className="rh-more rh-add" type="button" onClick={() => setNaming(group.id)}>
                <Plus size={12} /> 新建
              </button>
            ) : null}
          </header>
          {group.rows.length === 0 ? (
            <p className="pg-note">这个账号还没有歌单。</p>
          ) : (
            <div className="pl-grid">
              {group.rows.map((row) => (
                <Card key={row.key} row={row} />
              ))}
            </div>
          )}
        </section>
      ))}

      {naming ? (
        <NameModal
          title={'在' + (PLAYLIST_PROVIDERS.find((platform) => platform.id === naming)?.label ?? '平台') + '新建歌单'}
          label="名字"
          placeholder="例如 深夜循环"
          confirmText="创建"
          onCancel={() => setNaming(null)}
          onConfirm={(name) => void create(name)}
        />
      ) : null}
    </div>
  )
}

function Card({ row }: { row: PlaylistCard }) {
  return (
    <button className="rh-card pl-card" type="button" onClick={() => openOnlinePlaylist(row.providerId, row)}>
      <span className="rh-card__art" style={{ background: tint(row.key) }}>
        {/* 封面走主进程代理：页面 CSP 不允许外域图片，原地址由 aurora-remote:// 转发。 */}
        {row.coverUrl ? (
          <img
            src={remoteImageUrl(sizedImage(row.coverUrl, 300))}
            alt=""
            loading="lazy"
            /* 失效的封面藏起来退回渐变底，别留浏览器那张碎图图标。 */
            onError={(event) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <Note size={20} />
        )}
      </span>
      <span className="rh-card__title">{row.name}</span>
      <span className="rh-card__sub">
        {row.trackCount > 0 ? row.trackCount + ' 首' : row.providerLabel}
        {row.creator ? ' · ' + row.creator : ''}
      </span>
    </button>
  )
}

function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return 'linear-gradient(150deg, hsl(' + (h % 360) + ' 30% 26% / 0.4), hsl(' + ((h + 40) % 360) + ' 26% 13% / 0.5))'
}
