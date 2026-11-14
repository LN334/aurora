import { useEffect, useMemo, useState } from 'react'
import type { ShellRoute } from '../app/shell'
import { likedTracks, useFavorites } from '../features/favorites/store'
import { lyricsTextFor } from '../features/library/hooks'
import { pickLyricExcerpt } from '../features/lyrics/excerpt'
import { invalidatePlatformLiked, usePlatformLiked } from '../features/online/platform-liked'
import { mergeVersions, sourcesOf } from '../features/online/unify'
import { sourceOrder } from '../features/settings/source-order'
import { player } from '../features/player/actions'
import { usePlayer } from '../features/player/store'
import { formatSpan } from '../ui/format'
import { Play, Shuffle } from '../ui/icons'
import { TrackList, type TrackMenuRequest } from '../ui/TrackList'

const SOURCES: Record<string, string> = {
  netease: '网易云',
  qq: 'QQ 音乐',
  kugou: '酷狗',
  qishui: '汽水'
}

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
  const liked = useFavorites((state) => state.liked)
  const currentId = usePlayer((state) => (state.index >= 0 ? (state.queue[state.index]?.id ?? null) : null))
  const playing = usePlayer((state) => state.playing)

  /*
   * 本地心标 + 各平台账号里的「我喜欢的」，合成一张表。
   * 同一首在两家平台都有时由 mergeVersions 并成一行，两个平台徽章并排，
   * 播的时候按设置里的音源优先级挑一个——收藏页不该出现两行一样的歌名。
   */
  const { tracks: platformLiked, loading: platformLoading } = usePlatformLiked()
  const order = useMemo(() => sourceOrder(), [])
  const tracks = useMemo(
    () => mergeVersions([...likedTracks(liked), ...platformLiked], order),
    [liked, platformLiked, order]
  )
  const seconds = useMemo(() => tracks.reduce((sum, track) => sum + (track.duration || 0), 0), [tracks])

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
  const spread = useMemo(() => {
    const out: Record<string, number> = {}
    for (const track of tracks) {
      for (const key of sourcesOf(track, order)) out[key] = (out[key] ?? 0) + 1
    }
    return out
  }, [tracks])

  /*
   * 词卡上放哪一首：随机。只依赖长度：收藏时多一首少一首不必把卡面整个换掉，
   * 那样每点一次心，页面就抖一下。
   */
  const hero = useMemo(() => {
    if (!tracks.length) return null
    return tracks[Math.floor(Math.random() * tracks.length)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.length])

  const [excerpt, setExcerpt] = useState<string[]>([])
  useEffect(() => {
    if (!hero) {
      setExcerpt([])
      return
    }
    let cancelled = false
    /*
     * 先清空：换到另一首时，上一首的词留在卡上比空着更糟。
     * 取不到词就让它空着——卡本身的封面与标题已经成立，不编一句假词。
     */
    setExcerpt([])
    void lyricsTextFor(hero)
      .then((raw) => {
        if (!cancelled && raw) setExcerpt(pickLyricExcerpt(raw))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [hero])

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
      <button
        className="lk-hero"
        type="button"
        onClick={() => player.playQueue(tracks, 0)}
        title={`播放全部 ${tracks.length} 首`}
      >
        {/*
          * 词在上、标题在下。不铺封面：这三行词本身就是卡面，铺一张图反而要
          * 压暗、要挑有封面的歌，浅色主题里还会像一块贴错地方的深色板。
          */}
        <span className="lk-hero__words">
          {excerpt.map((line, index) => (
            <span className="lk-hero__line" key={`${index}-${line}`}>
              {line}
            </span>
          ))}
        </span>
        <span className="lk-hero__foot">
          <span className="lk-hero__titles">
            <span className="lk-hero__title">我喜欢的音乐</span>
            <span className="lk-hero__stat">
              {tracks.length} 首 · {formatSpan(seconds)}
            </span>
          </span>
          <span className="lk-hero__play">
            <Play size={13} />
            播放全部
          </span>
        </span>
      </button>

      <header className="rh-sec__head lk-head">
        <span className="pl-head__count">
          {Object.entries(spread).map(([key, count], index) => (
            <span key={key}>
              {index > 0 ? ' · ' : ''}
              {SOURCES[key] ?? '本机'} {count}
            </span>
          ))}
        </span>
        <span className="lk-head__acts">
          {/*
           * 「播放全部」已经在那张卡上，这里只留两件卡上放不下的操作：
           * 打乱，和重读平台收藏。
           */}
          <button
            className="rh-btn"
            type="button"
            onClick={() => player.playQueue(shuffled(tracks), 0)}
          >
            <Shuffle size={13} />
            随机
          </button>
          {/*
            * 平台那半边是十分钟缓存。在这个页面之外（手机 App、网页版）点了心，
            * 或者想立刻确认刚点的这一下，就靠这颗按钮重读一次；不必重启应用。
            */}
          <button
            className="rh-btn"
            type="button"
            onClick={() => invalidatePlatformLiked()}
            title="重新读一次各平台的收藏"
          >
            刷新
          </button>
        </span>
      </header>
      <TrackList
        tracks={tracks}
        currentId={currentId}
        playing={playing}
        onPlayAt={(index) => player.playQueue(tracks, index)}
        onMenu={onMenu}
      />
    </div>
  )
}

/** Fisher–Yates。不改原数组：列表还挂在 store 上，就地打乱会让页面自己跳一下。 */
function shuffled<T>(list: T[]): T[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]
    out[i] = out[j]
    out[j] = a
  }
  return out
}
