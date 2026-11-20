import { useEffect, useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { newestFirst, likeSourceOf } from '../features/favorites/like-source'
import { useLikes } from '../features/favorites/likes'
import { likedReadFailed } from '../features/online/liked-merge'
import { invalidatePlatformLiked, usePlatformLiked } from '../features/online/platform-liked'
import { mergeVersions } from '../features/online/unify'
import { sourceOrder } from '../features/settings/source-order'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { formatSpan } from '../ui/format'
import { Play } from '../ui/icons'
import { ShelfSearch, shelfMatches } from '../ui/ShelfSearch'
import { FILTER_EVENT } from '../ui/filter-event'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'



/**
 * 我喜欢的音乐。
 *
 * 这里是「我点过心」的那一堆，来源打散：本机文件、网易云、QQ 可能都在里面。
 * 所以卡片下面一行给分布（多少首来自哪），不然一屏歌名读不出它们其实不是一回事。
 * 列表本身交给 TrackList——收藏页和歌单页共用同一份行组件，收藏键才只有一处。
 *
 * 顶部那张词卡的底是随机一首收藏的封面，上面压着它自己的三行词。收藏页最容易
 * 变成一张没有表情的表格，封面和词让它在打开的第一秒就说出「这是你的歌」。
 * 整张卡是一个按钮：点哪里都从头播这一份收藏（与右下角那颗胶囊同一件事）。
 */
export function LikedPage({
  onNavigate,
  onMenu
}: {
  onNavigate(route: ShellRoute): void
  onMenu(request: TrackMenuRequest): void
}) {
  const currentId = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index]?.id ?? null) : null))
  const playing = usePlayer((state) => state.playing)

  /*
   * 本地心标 + 各平台账号里的「我喜欢的」，合成一张表。
   * 同一首在两家平台都有时由 mergeVersions 并成一行，两个平台徽章并排，
   * 播的时候按设置里的音源优先级挑一个——收藏页不该出现两行一样的歌名。
   */
  const {
    tracks: platformLiked,
    loading: platformLoading,
    failed: platformFailed,
    pending: platformPending
  } = usePlatformLiked()
  const order = useMemo(() => sourceOrder(), [])
  /*
   * 一条时间线，不是两块拼起来：本地点心带 `at`，平台那份带我们点红心的时刻
   * （`useLikes.stamps`）。以前本地整块在前、平台整块在后，于是刚在首页点红的
   * 在线歌不会出现在最上面——看着像「没收进去」。
   */
  const stamps = useLikes((state) => state.stamps)
  const tracks = useMemo(() => {
    /*
     * 这一页只有平台账号里的红心。本机文件没有喜欢——本地这件事只有下载，
     * 所以下载下来的歌不会出现在这里，本机收藏也不再混进来。
     */
    const platformRows = platformLiked.map((track) => ({
      track,
      at: stamps[likeSourceOf(track) + ':' + track.id] ?? 0
    }))
    return mergeVersions(
      newestFirst(platformRows).map((row) => row.track),
      order
    )
  }, [platformLiked, stamps, order])
  const seconds = useMemo(() => tracks.reduce((sum, track) => sum + (track.duration || 0), 0), [tracks])

  /*
   * 收藏到六百多首以后，找一首只能靠滚。搜索只筛列表，不动上面那张词卡：
   * 卡是「你收藏的这些歌」的表情，筛到只剩三首时换一张脸反而像换了页面。
   * 播放全部与随机也跟着筛后的列表走 —— 搜到了却播不到，是这个框最没用的状态。
   */
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const text = query.trim()
    if (!text) return tracks
    return tracks.filter((track) => shelfMatches(text, track.title, track.artist, track.album ?? ''))
  }, [tracks, query])

  /* 网络慢的时候干等会让人以为卡死：八秒后给一句实话和一个重试。 */
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!platformLoading) {
      setSlow(false)
      return
    }
    const timer = window.setTimeout(() => setSlow(true), 8000)
    return () => window.clearTimeout(timer)
  }, [platformLoading])

  /*
   * 平台那半边还在读的时候不画空态。
   *
   * 本地心标立刻就有，平台的要走一趟网络；两者没到齐就说「还没有喜欢的歌」，
   * 等于把「正在读」说成「你没有」，页面随后再自己换一张脸。
   */
  if (platformLoading && tracks.length === 0) {
    return (
      <div className="col">
        {slow ? (
          /*
           * 干等没有出路，人会以为卡死。八秒后换一句实话，并给一个再问一次的
           * 按钮——它作废缓存后 hook 会重新读，不用重启应用。
           */
          <div className="pg-empty">
            <h2>还在读各平台的收藏</h2>
            <p>比平常慢。可以再问一次，也可以先去听本机的。</p>
            <button className="rh-btn" type="button" onClick={() => invalidatePlatformLiked()}>
              重新读取
            </button>
          </div>
        ) : (
          <p className="pg-note">正在读取各平台的收藏…</p>
        )}
      </div>
    )
  }

  /*
   * 一条都没读到、而这一趟有平台没应答：说「还没有喜欢的歌」是撒谎。
   * 2026-11-17 网易云接口 502 断了两次，这一页就是这么说的。
   */
  if (likedReadFailed(tracks.length, platformFailed)) {
    return (
      <div className="pg-empty">
        <h2>这次没读到各平台的收藏</h2>
        <p>接口没有应答。你的收藏没被删，再问一次就好。</p>
        <button className="rh-btn" type="button" onClick={() => invalidatePlatformLiked()}>
          重新读取
        </button>
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <div className="pg-empty">
        <h2>还没有喜欢的歌</h2>
        <p>点心收藏</p>
        <button className="rh-btn" type="button" onClick={() => onNavigate({ view: 'home' })}>
          去推荐页
        </button>
      </div>
    )
  }

  return (
    <div className="col">
      {/*
        这张卡只做一件事：告诉你收藏了多少、加起来多长，点一下全放。
        以前它还会从收藏里随机抽一首、摘三行词当卡面——那几行词和「我喜欢的
        音乐」这个集合没有任何关系，看不懂也就不奇怪。词留在正在播放页。
      */}
      <button
        className="lk-hero is-quiet"
        type="button"
        onClick={() => player.playQueue(tracks, 0)}
        title={`播放全部 ${tracks.length} 首`}
      >
        <span className="lk-hero__foot">
          {/*
            * 卡里不再写一遍「我喜欢的音乐」——页头已经写着，同一页说两次只是
            * 噪音。这里只留规模：多少首、多长。
            */}
          <span className="lk-hero__stat">
            {tracks.length} 首 · {formatSpan(seconds)}
          </span>
          <span className="lk-hero__play">
            <Play size={13} />
            播放全部
          </span>
        </span>
      </button>

      {/*
        * 筛选框自己占一行：收起时什么都不画（页头那颗「筛选」代管），
        * 展开时才是真的输入框。以前这里是「空行 + 一颗漂在中间的刷新」——
        * 既不像标题也不像列表，读起来像两件贴错地方的零件。
        */}
      <ShelfSearch
        value={query}
        placeholder="搜歌名、歌手、专辑"
        onChange={setQuery}
        listenEvent={FILTER_EVENT}
        hideTrigger
      />

      {/*
        * 读到哪儿了，就一行字。
        *
        * 「正在读取各平台的收藏…」占满整页时不说话是有道理的——那时确实什么都没有；
        * 但列表已经能看了还摆着一句空态，等于把「一部分到了」说成「没有了」。
        * 现在它退成列表上方的一行小字，说清还差几家、已经到多少首。
        */}
      {query.trim() ? (
        <p className="lk-stage">
          命中 {shown.length} / {tracks.length} 首
        </p>
      ) : platformPending > 0 ? (
        <p className="lk-stage">
          还有 {platformPending} 家没读完 · 已经到 {tracks.length} 首
        </p>
      ) : platformFailed > 0 ? (
        <p className="lk-stage is-warn">
          {platformFailed} 家这次没读到（收藏没被删）· 点上面的刷新再问一次
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="shelf-empty">没有匹配的歌。</p>
      ) : (
        <TrackList
          tracks={shown}
          currentId={currentId}
          playing={playing}
          onPlayAt={(index) => player.playQueue(shown, index)}
          onMenu={onMenu}
        />
      )}
    </div>
  )
}

