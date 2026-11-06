import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { NeteaseDiscoverPlaylist, NeteaseSong } from '../../env'
import { ArtCard } from '../../ui/ArtCard'
import { TrackList } from '../../ui/TrackList'
import { usePlayer } from '../player/store'
import { remoteImageUrl } from '../player/urls'
import { useAvailableProviders } from '../online/hooks'
import { useOnlineStore } from '../online/store'
import { QqLogin, setLoginOpen as setQqLoginOpen, useQqLoginOpen } from '../qq/QqLogin'
import { hasNeteaseDiscover, netease } from '../netease/api'
import { useNetease } from '../netease/store'
import { toTrack } from '../netease/track'
import {
  DISCOVER_TABS,
  emptyTextFor,
  hasContent,
  normalizeSongs,
  playlistMeta,
  playlistSubtitle
} from './pure'
import { useDiscover } from './store'
import './discover.css'

/**
 * 「发现」——平台推荐的公共内容，不需要登录。
 *
 * 第一排是平台，第二排是该平台的栏目，下面是内容。网易云的三栏都走
 * 匿名可用的公开接口（`netease:discover`），所以冷启动、没登录、刚装好
 * 的账号也能看到东西并直接播放——这是这页存在的理由；README 里「未登录
 * 时在线首页内容偏少」说的正是缺这一页。
 *
 * 平台列表来自 provider registry，不写死：以后接了别的平台，这里自动多
 * 一个标签；那个平台如果没有公开推荐，就显示它自己的能力说明。
 */

/** 读失败时给用户看的那句话：优先上游/主进程的错因，太技术的不往外抛。 */
function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return '网络请求失败'
}

interface DetailTarget {
  playlist: NeteaseDiscoverPlaylist
}

export function DiscoverView() {
  const providers = useAvailableProviders()
  const [platformId, setPlatformId] = useState('')
  const activeProvider = providers.find((item) => item.id === platformId) ?? providers[0] ?? null

  const tab = useDiscover((state) => state.tab)
  const setTab = useDiscover((state) => state.setTab)
  const load = useDiscover((state) => state.load)
  const block = useDiscover((state) => state.blocks[state.tab])

  const currentTrack = usePlayer((state) =>
    state.index >= 0 ? (state.queue[state.index] ?? null) : null
  )
  const playing = usePlayer((state) => state.playing)

  /*
   * 只有「当前平台是网易云，并且这个构建有主进程通道」才去读。浏览器预览里
   * 没有 IPC，直接给空态，不反复重试一个必然失败的请求。
   */
  const neteaseReady = activeProvider?.id === 'netease' && hasNeteaseDiscover()

  useEffect(() => {
    if (!neteaseReady) return
    void load(tab)
  }, [neteaseReady, tab, load])

  /* 歌单详情：在同一页展开，不跳路由——发现页是首屏，跳走再回来要重新等。 */
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  const [detailSongs, setDetailSongs] = useState<NeteaseSong[]>([])
  const [detailStatus, setDetailStatus] = useState<'loading' | 'ready' | 'failed'>('ready')
  const [detailError, setDetailError] = useState('')

  const openPlaylist = useCallback(async (playlist: NeteaseDiscoverPlaylist) => {
    setDetail({ playlist })
    setDetailSongs([])
    setDetailError('')
    setDetailStatus('loading')
    try {
      const songs = normalizeSongs(await netease.playlistTracks(playlist.id))
      setDetailSongs(songs)
      setDetailStatus('ready')
    } catch (error) {
      setDetailError(errorText(error))
      setDetailStatus('failed')
    }
  }, [])

  /** 卡片上的播放钮：读歌单再整列进队列，行为和点开之后「播放全部」一致。 */
  const playPlaylist = useCallback(async (playlist: NeteaseDiscoverPlaylist) => {
    try {
      const songs = normalizeSongs(await netease.playlistTracks(playlist.id))
      if (songs.length === 0) return
      await useNetease.getState().playSongsAt(songs, 0)
    } catch {
      // 播放失败不该把整页变成错误态：卡片上的「打开」仍然可用，用户还能看内容。
    }
  }, [])

  const playFrom = useCallback((songs: NeteaseSong[], index: number) => {
    void useNetease.getState().playSongsAt(songs, index)
  }, [])

  const songRows = useMemo(() => block.songs.map((song) => toTrack(song)), [block.songs])
  const detailRows = useMemo(() => detailSongs.map((song) => toTrack(song)), [detailSongs])

  const handlePlatform = (providerId: string) => {
    setPlatformId(providerId)
    setDetail(null)
  }

  const handleTab = (kind: typeof tab) => {
    setTab(kind)
    setDetail(null)
  }

  const retry = () => {
    void load(tab, { force: true })
  }

  const cards = (
    <div className="grid">
      {block.playlists.map((playlist, index) => (
        <ArtCard
          key={playlist.id}
          className={index === 0 ? 'discover__lead' : undefined}
          title={playlist.name}
          subtitle={playlistSubtitle(playlist)}
          meta={playlistMeta(playlist)}
          src={playlist.coverUrl ? remoteImageUrl(playlist.coverUrl) : null}
          onOpen={() => void openPlaylist(playlist)}
          onPlay={() => void playPlaylist(playlist)}
        />
      ))}
    </div>
  )

  const songs = (
    <div className="discover__detail">
      <div className="discover__detail-head">
        <button
          className="btn btn--accent"
          disabled={block.songs.length === 0}
          onClick={() => playFrom(block.songs, 0)}
        >
          播放全部
        </button>
        <span className="discover__detail-meta">{songRows.length} 首</span>
      </div>
      <TrackList
        tracks={songRows}
        currentId={currentTrack?.id ?? null}
        playing={playing}
        onPlayAt={(index) => playFrom(block.songs, index)}
      />
    </div>
  )

  const detailPanel = detail ? (
    <div className="discover__detail">
      <div className="discover__detail-head">
        <button className="btn" onClick={() => setDetail(null)}>
          ← 返回推荐
        </button>
        <div className="discover__detail-titles">
          <h2 className="discover__detail-name">{detail.playlist.name}</h2>
          <div className="discover__detail-meta">{playlistMeta(detail.playlist)}</div>
        </div>
        <button
          className="btn btn--accent"
          disabled={detailSongs.length === 0}
          onClick={() => playFrom(detailSongs, 0)}
        >
          播放全部
        </button>
      </div>
      {detailStatus === 'loading' ? (
        <p className="discover__loading" aria-busy="true">
          正在读取歌单…
        </p>
      ) : detailStatus === 'failed' ? (
        <div className="discover__fail">
          <p className="discover__fail-text">读取歌单失败：{detailError}</p>
          <button className="btn" onClick={() => void openPlaylist(detail.playlist)}>
            重试
          </button>
        </div>
      ) : detailSongs.length === 0 ? (
        <p className="online__hint">这个歌单里没有能播放的曲子。</p>
      ) : (
        <TrackList
          tracks={detailRows}
          currentId={currentTrack?.id ?? null}
          playing={playing}
          onPlayAt={(index) => playFrom(detailSongs, index)}
        />
      )}
    </div>
  ) : null

  let body: ReactNode
  if (providers.length === 0) {
    body = <div className="notice">这个构建没有接入在线音源，发现页暂时没有内容。</div>
  } else if (!activeProvider) {
    body = null
  } else if (activeProvider.id !== 'netease') {
    body = <ProviderGate providerId={activeProvider.id} providerName={activeProvider.displayName} />
  } else if (!neteaseReady) {
    body = (
      <div className="notice">
        这个构建没有主进程的在线通道，发现页暂时没有内容。用桌面版打开就能看到推荐。
      </div>
    )
  } else if (detail) {
    body = detailPanel
  } else if (block.status === 'idle' || block.status === 'loading') {
    body = (
      <p className="discover__loading" aria-busy="true">
        正在读取推荐…
      </p>
    )
  } else if (block.status === 'failed') {
    body = (
      <div className="discover__fail">
        <p className="discover__fail-text">读取推荐失败：{block.error}</p>
        <button className="btn" onClick={retry}>
          重试
        </button>
      </div>
    )
  } else if (!hasContent(tab, block)) {
    body = <div className="notice">{emptyTextFor(tab, activeProvider.displayName)}</div>
  } else if (tab === 'newsongs') {
    body = songs
  } else {
    body = cards
  }

  return (
    <div className="library">
      <div className="tabs tabs--sources" role="tablist" aria-label="平台">
        {providers.map((provider) => {
          const active = provider.id === activeProvider?.id
          return (
            <button
              key={provider.id}
              className={`tab${active ? ' is-active' : ''}`}
              role="tab"
              aria-selected={active}
              onClick={() => handlePlatform(provider.id)}
            >
              {provider.shortName ?? provider.displayName}
            </button>
          )
        })}
      </div>

      {activeProvider?.id === 'netease' ? (
        <div className="tabs tabs--sub" role="tablist" aria-label="栏目">
          {DISCOVER_TABS.map((item) => {
            const active = item.id === tab
            return (
              <button
                key={item.id}
                className={`tab${active ? ' is-active' : ''}`}
                role="tab"
                aria-selected={active}
                onClick={() => handleTab(item.id)}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="library__body">{body}</div>
    </div>
  )
}

/**
 * 平台没有公开推荐接口时的说明。
 *
 * QQ 音乐是已知的一例：推荐内容只对登录态开放，所以这里给的是「为什么看不到」
 * 和一个现有的扫码登录入口（复用 QqLogin，不另造流程）。登录弹窗由 QqLogin
 * 自己渲染成覆盖层，本组件只负责打开它。
 */
function ProviderGate({ providerId, providerName }: { providerId: string; providerName: string }) {
  const loginOpen = useQqLoginOpen((state) => state.open)
  const account = useOnlineStore('qq')((state) => state.account)

  if (providerId !== 'qq') {
    return <div className="notice">{providerName} 还没有公开的推荐接口，暂时只有搜索和你的歌单。</div>
  }

  return (
    <div className="discover__gate">
      <p className="discover__gate-title">需要登录 QQ 音乐后才能看推荐</p>
      <p className="discover__gate-note">
        {account
          ? `已登录${account.nickname ? `（${account.nickname}）` : ''}。QQ 音乐的推荐接口没有公开入口，你的歌单和收藏在「音乐库 → QQ 音乐」里。`
          : 'QQ 音乐的推荐内容只对登录态开放。扫码登录后，歌单和收藏会出现在「音乐库」里，这里也就能显示推荐。'}
      </p>
      <button className="btn btn--accent" onClick={() => setQqLoginOpen(true)}>
        扫码登录 QQ 音乐
      </button>
      {loginOpen ? <QqLogin onClose={() => setQqLoginOpen(false)} /> : null}
    </div>
  )
}
