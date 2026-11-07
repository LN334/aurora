import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { NeteaseDiscoverPlaylist, NeteaseSong } from '../../env'
import { ArtCard } from '../../ui/ArtCard'
import { TrackList } from '../../ui/TrackList'
import { Note, Play } from '../../ui/icons'
import { usePlayer } from '../player/store'
import { remoteImageUrl, sizedImage } from '../player/urls'
import { useAvailableProviders } from '../online/hooks'
import { QqLogin, setLoginOpen as setQqLoginOpen, useQqLoginOpen } from '../qq/QqLogin'
import { hasNeteaseDiscover, netease } from '../netease/api'
import { useNetease } from '../netease/store'
import { toTrack } from '../netease/track'
import {
  DISCOVER_TAB_HINTS,
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

export function DiscoverView({ embedded = false }: { embedded?: boolean } = {}) {
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
    // 「换一批」= 游标前进一页。重发同一个请求没有用：上游推荐一天一份。
    void useDiscover.getState().next(tab)
  }

  /*
   * 卡片一律同尺寸。以前第一张跨两列、封面 2:1，本意是做个「精选」重点，
   * 实际效果是第一行比后面高、右边空出一格（网格是 auto-fill），整块看着
   * 像没对齐。推荐位要突出靠位置和顺序，不靠把一张卡撑大。
   */
  const cards = (
    <div className="picks__grid">
      {block.playlists.map((playlist) => (
        <ArtCard
          key={playlist.id}
          title={playlist.name}
          subtitle={playlistSubtitle(playlist)}
          meta={playlistMeta(playlist)}
          src={playlist.coverUrl ? remoteImageUrl(sizedImage(playlist.coverUrl, 360)) : null}
          onOpen={() => void openPlaylist(playlist)}
          onPlay={() => void playPlaylist(playlist)}
        />
      ))}
    </div>
  )

  /*
   * 推荐歌曲用三列紧凑行，不用表格：主页这一块是「看看有什么」而不是
   * 「管理歌曲」，表格的列头、序号、专辑列在这里全是噪音。封面取专辑封面
   * （网易云的歌曲行没有自己的图），点击即播。
   */
  const songGrid = (
    <div className="picks__songs">
      {block.songs.map((song, index) => {
        const track = songRows[index]
        const active = Boolean(track && currentTrack?.id === track.id)
        return (
          <button
            key={song.id}
            type="button"
            className={`picks-song${active ? ' is-current' : ''}`}
            onClick={() => playFrom(block.songs, index)}
            title={`播放 ${song.name}`}
          >
            <span className="picks-song__art">
              {song.album?.picUrl ? (
                <img
                  src={remoteImageUrl(sizedImage(song.album.picUrl, 120))}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <Note size={16} />
              )}
            </span>
            <span className="picks-song__text">
              <span className="picks-song__name">{song.name}</span>
              <span className="picks-song__artist">
                {song.artists.map((artist) => artist.name).join(' / ')}
              </span>
            </span>
          </button>
        )
      })}
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
    body = <ProviderGate providerId={activeProvider.id} />
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
    body = songGrid
  } else {
    body = cards
  }

  const platformTabs = (
    <div className={embedded ? 'tabs picks__plat' : 'tabs tabs--sources'} role="tablist" aria-label="平台">
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
  )

  const contentTabButtons =
    activeProvider?.id === 'netease'
      ? DISCOVER_TABS.map((item) => {
          const active = item.id === tab
          return (
            <button
              key={item.id}
              className={`tab${active ? ' is-active' : ''}`}
              role="tab"
              aria-selected={active}
              title={DISCOVER_TAB_HINTS[item.id]}
              onClick={() => handleTab(item.id)}
            >
              {item.label}
            </button>
          )
        })
      : null

  /* 播放全部只对「推荐歌曲」有意义：歌单栏目点卡片本身就是进歌单。 */
  const playAllButton =
    tab === 'newsongs' && block.songs.length > 0 ? (
      <button
        className="picks__play"
        type="button"
        onClick={() => playFrom(block.songs, 0)}
        title="把这 24 首按顺序放进队列"
      >
        <Play size={12} />
        播放全部
      </button>
    ) : null

  const refreshButton = (
    <button
      className="tabs__action"
      type="button"
      disabled={block.status === 'loading'}
      onClick={retry}
      title="重新读一次这一栏；网易云的推荐大约十分钟变一次"
    >
      {block.status === 'loading' ? '换一批中…' : '换一批'}
    </button>
  )

  /*
   * 嵌在主页里时只占一行：栏目在左，平台和「换一批」在右。
   * 独立成页时仍是「平台一排、栏目一排」——那一页没有外面的标题，两排才够用。
   */
  if (embedded) {
    return (
      <div className="picks">
        <div className="picks__bar">
          {contentTabButtons ? (
            <div className="tabs tabs--sub" role="tablist" aria-label="栏目">
              {contentTabButtons}
            </div>
          ) : null}
          <div className="picks__side">
            {playAllButton}
            {platformTabs}
            {refreshButton}
          </div>
        </div>
        <div className="picks__body">{body}</div>
      </div>
    )
  }

  return (
    <div className="library">
      {platformTabs}
      {contentTabButtons ? (
        <div className="tabs tabs--sub" role="tablist" aria-label="栏目">
          {contentTabButtons}
          <span className="picks__side">
            {playAllButton}
            {refreshButton}
          </span>
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
function ProviderGate({ providerId }: { providerId: string }) {
  const loginOpen = useQqLoginOpen((state) => state.open)

  if (providerId !== 'qq') {
    return <div className="notice">暂无推荐</div>
  }

  return (
    <div className="discover__gate">
      <p className="discover__gate-title">需要登录 QQ 音乐后才能看推荐</p>
      <p className="discover__gate-note">登录后查看推荐</p>
      <button className="btn btn--accent" onClick={() => setQqLoginOpen(true)}>
        扫码登录 QQ 音乐
      </button>
      {loginOpen ? <QqLogin onClose={() => setQqLoginOpen(false)} /> : null}
    </div>
  )
}
