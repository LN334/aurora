import { useEffect, useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { useLibrary } from '../features/library/store'
import { useOnlineStore } from '../features/online/store'
import type { ProviderId } from '../features/online/types'
import { usePlaylists } from '../features/playlists/store'
import { remoteImageUrl, sizedImage } from '../features/player/urls'
import { openOnlinePlaylist } from '../features/refs/navigate'
import { formatTime } from '../ui/format'
import { Note, Play, Plus } from '../ui/icons'
import { NameModal } from './NameModal'

/**
 * 平台歌单和自建歌单排在同一页、同一张网里。
 *
 * 平台是「歌从哪来」，不是「你去哪一页」。以前的写法是按平台分段，一段一个
 * 标题，找一张歌单得先想清楚它在哪个平台——那是把数据来源变成了导航层级。
 * 现在只有一排筛选：想看全部就全部，想只看某一家就点那一家。
 */
const PLATFORM_ORDER: { id: ProviderId; label: string }[] = [
  { id: 'netease', label: '网易云音乐' },
  { id: 'qq', label: 'QQ 音乐' },
  { id: 'kugou', label: '酷狗音乐' },
  { id: 'qishui', label: '汽水音乐' }
]

interface ShelfCard {
  key: string
  providerId: ProviderId
  providerLabel: string
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  creator: string
}

/**
 * 四个平台的歌单。
 *
 * 调用次数写死成四：hooks 不能放在循环里，而平台表本来就是常量。多一个平台
 * 只改这里的 PLATFORM_ORDER 与这四行调用，两处挨着，漏掉一眼能看见。
 */
function useShelves() {
  const netease = useOnlineStore('netease')()
  const qq = useOnlineStore('qq')()
  const kugou = useOnlineStore('kugou')()
  const qishui = useOnlineStore('qishui')()

  useEffect(() => {
    // 未接入的平台会回一个空壳，init 只是让它自己报「连不上」，不会抛出去。
    for (const id of ['netease', 'qq', 'kugou', 'qishui']) {
      void useOnlineStore(id).getState().init().catch(() => {})
    }
  }, [])

  return useMemo(() => {
    const rows: ShelfCard[] = []
    const push = (providerId: ProviderId, providerLabel: string, list: typeof netease.playlists) => {
      for (const playlist of list) {
        rows.push({
          key: providerId + ':' + playlist.id,
          providerId,
          providerLabel,
          id: playlist.id,
          name: playlist.name,
          coverUrl: playlist.coverUrl,
          trackCount: playlist.trackCount,
          creator: playlist.creator
        })
      }
    }
    push('netease', '网易云音乐', netease.playlists)
    push('qq', 'QQ 音乐', qq.playlists)
    push('kugou', '酷狗音乐', kugou.playlists)
    push('qishui', '汽水音乐', qishui.playlists)
    return rows
  }, [netease.playlists, qq.playlists, kugou.playlists, qishui.playlists])
}

/**
 * 歌单。
 *
 * 一屏就是所有自己建的、订阅的、各平台账号里带过来的列表。本地自建的排在最前
 * （那是唯一能改的），平台的跟在后面，卡片一样大——它们对「找一张来听」是同
 * 一件事，不该在视觉上分等级。
 */
export function PlaylistsView({ onNavigate }: { onNavigate(route: ShellRoute): void }) {
  const playlists = usePlaylists((state) => state.playlists)
  const create = usePlaylists((state) => state.create)
  const tracks = useLibrary((state) => state.tracks)
  const index = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const [naming, setNaming] = useState(false)
  const [only, setOnly] = useState<'all' | ProviderId>('all')

  const shelves = useShelves()

  /** 只列出真有歌单的平台，没登录的平台不该占一个筛选项。 */
  const sources = useMemo(() => {
    const counts = new Map<ProviderId, number>()
    for (const row of shelves) counts.set(row.providerId, (counts.get(row.providerId) ?? 0) + 1)
    return PLATFORM_ORDER.filter((item) => (counts.get(item.id) ?? 0) > 0).map((item) => ({
      ...item,
      count: counts.get(item.id) ?? 0
    }))
  }, [shelves])

  const shown = only === 'all' ? shelves : shelves.filter((row) => row.providerId === only)

  /** 建完直接进去，而不是把人留在原地——新建的动作总该有个去处。 */
  const confirmName = (name: string) => {
    const playlist = create(name)
    setNaming(false)
    onNavigate({ view: 'playlist', id: playlist.id })
  }

  const platformNote = shown.length > 0 ? ' · 平台 ' + shown.length + ' 张' : ''

  return (
    <div className="col">
      <header className="rh-sec__head pl-head">
        <h3>自建歌单</h3>
        <span className="pl-head__count">
          {playlists.length} 个{platformNote}
        </span>
        <span className="pl-head__sp" />
        <button className="rh-btn" type="button" onClick={() => setNaming(true)}>
          <Plus size={14} />
          新建歌单
        </button>
      </header>

      {sources.length > 1 ? (
        <div className="pl-filter">
          <button
            className={'pl-chip' + (only === 'all' ? ' is-on' : '')}
            type="button"
            onClick={() => setOnly('all')}
          >
            全部
          </button>
          {sources.map((item) => (
            <button
              className={'pl-chip' + (only === item.id ? ' is-on' : '')}
              type="button"
              key={item.id}
              onClick={() => setOnly(item.id)}
            >
              <span className={'src-dot src-dot--' + item.id} aria-hidden="true" />
              {item.label}
              <span className="pl-chip__n">{item.count}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="pl-grid">
        {only === 'all'
          ? playlists.map((playlist) => {
              const own = playlist.trackIds.map((id) => index.get(id)).filter(Boolean)
              const seconds = own.reduce((sum, track) => sum + (track?.duration ?? 0), 0)
              const first = own[0]
              return (
                <button
                  className="rh-card pl-card"
                  type="button"
                  key={playlist.id}
                  onClick={() => onNavigate({ view: 'playlist', id: playlist.id })}
                >
                  <span className="rh-card__art" style={{ background: tint(playlist.id) }}>
                    {first ? (
                      <span className="rh-card__glyph">
                        <Play size={18} />
                      </span>
                    ) : (
                      <Note size={20} />
                    )}
                  </span>
                  <span className="rh-card__title">{playlist.name}</span>
                  <span className="rh-card__sub">
                    {playlist.trackIds.length} 首 · {formatTime(seconds)}
                  </span>
                </button>
              )
            })
          : null}

        {shown.map((row) => (
          <button
            className="rh-card pl-card"
            type="button"
            key={row.key}
            onClick={() => openOnlinePlaylist(row.providerId, row.id)}
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
              {row.trackCount} 首{row.creator ? ' · ' + row.creator : ''}
            </span>
          </button>
        ))}

        {only === 'all' ? (
          <button className="rh-card pl-card" type="button" onClick={() => setNaming(true)}>
            <span className="rh-card__art rh-card__art--add">
              <Plus size={22} />
            </span>
            <span className="rh-card__title">新建歌单</span>
            <span className="rh-card__sub">从曲库里挑歌</span>
          </button>
        ) : null}
      </div>

      {playlists.length === 0 && shown.length === 0 ? (
        <p className="pg-note">还没有歌单。新建一个，把喜欢的歌收进去。</p>
      ) : null}

      {naming ? (
        <NameModal
          title="新建歌单"
          label="名字"
          placeholder="例如 深夜循环"
          confirmText="创建"
          onCancel={() => setNaming(false)}
          onConfirm={confirmName}
        />
      ) : null}
    </div>
  )
}

function tint(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return 'linear-gradient(150deg, hsl(' + (h % 360) + ' 30% 26% / 0.4), hsl(' + ((h + 40) % 360) + ' 26% 13% / 0.5))'
}
