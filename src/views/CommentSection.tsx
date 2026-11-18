import { useEffect, useRef, useState } from 'react'
import type { OnlineComment } from '../env'
import type { Track } from '../types'
import { canComment, commentSourceName, fetchComments } from '../features/comments/api'
import { remoteImageUrl } from '../features/player/urls'
import { formatSince } from '../ui/format'
import { Comment as CommentIcon, Heart, User } from '../ui/icons'

/** 每页条数：四家上游都可按页取，20 条正好一屏半，滚动不空。 */
const PAGE_SIZE = 20

type Phase = 'loading' | 'ready' | 'failed'

/** 头像取不到时退回一个图标——评论区的空白头像框比破图更常见。 */
function Avatar({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span className="cmt__avatar" aria-hidden="true">
        <User size={15} />
      </span>
    )
  }
  /*
   * 头像直接指外域会被页面的 CSP 挡掉（img-src 里没有 http(s)），
   * 走主进程的 aurora-remote 代理：顺带缩到 60px，几十条评论不会各拉一张大图。
   */
  return (
    <span className="cmt__avatar" aria-hidden="true">
      <img src={remoteImageUrl(src, 60)} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  )
}

function CommentRow({ comment }: { comment: OnlineComment }) {
  /*
   * 上游给的是秒（四家接口都是秒，主进程统一过），formatSince 吃毫秒；
   * 没有时间戳的行留空，不编一个「刚刚」出来。
   */
  const when = comment.time ? formatSince(comment.time * 1000) : ''
  return (
    <li className="cmt__item">
      <Avatar src={comment.avatar} />
      <div className="cmt__body">
        <div className="cmt__meta">
          <span className="cmt__name">{comment.author}</span>
          {comment.featured ? <span className="cmt__badge">精选</span> : null}
          {when ? <span className="cmt__time">{when}</span> : null}
        </div>
        <p className="cmt__text">{comment.text}</p>
        {comment.likes > 0 || comment.replies > 0 ? (
          <div className="cmt__stats">
            {comment.likes > 0 ? (
              <span className="cmt__stat">
                <Heart size={12} />
                {comment.likes.toLocaleString('zh-CN')}
              </span>
            ) : null}
            {comment.replies > 0 ? (
              <span className="cmt__stat">{comment.replies.toLocaleString('zh-CN')} 条回复</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/**
 * 曲目详情页的评论区（只读）。
 *
 * 四个平台各自有一份评论接口，形状已经由主进程收成同一个 CommentPage；
 * 这一页只负责「画一页、再画下一页」，不认平台。本机文件没有可读的评论，
 * 整块不出现，而不是出现一面「暂无评论」的空壁。
 *
 * 不在这里做点赞与回复：那需要登录态与各家的写接口权限，读评论的代价是
 * 一次裸 GET，写不是。先把「别人在说什么」接进来。
 */
export function CommentSection({ track }: { track: Track }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [rows, setRows] = useState<OnlineComment[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [cursor, setCursor] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [paging, setPaging] = useState(false)
  const [pagingFailed, setPagingFailed] = useState(false)
  /*
   * 切歌时上一首的请求可能后到。用轮次认领：只有当前这一轮能写状态，
   * 否则会在新歌的评论下面续上旧歌的第二页。
   */
  const round = useRef(0)

  useEffect(() => {
    const mine = ++round.current
    setPhase('loading')
    setRows([])
    setTotal(null)
    setCursor('')
    setHasMore(false)
    setPaging(false)
    setPagingFailed(false)
    if (!canComment(track)) {
      setPhase('ready')
      return
    }
    void fetchComments(track, '', PAGE_SIZE).then((page) => {
      if (mine !== round.current) return
      if (!page) {
        setPhase('failed')
        return
      }
      setRows(page.comments)
      setTotal(page.total)
      setCursor(page.cursor)
      setHasMore(page.hasMore)
      setPhase('ready')
    })
    /*
     * 只认这三样：曲目行对象在别处可能被重建，而评论只跟「哪一家的哪首歌」
     * 有关。把这些键列全，切到同一首歌的另一个平台版本也会重取。
     */
  }, [track.id, track.source, track.onlineId])

  if (!canComment(track)) return null

  async function loadMore() {
    if (paging || !hasMore) return
    const mine = round.current
    setPaging(true)
    setPagingFailed(false)
    const page = await fetchComments(track, cursor, PAGE_SIZE)
    if (mine !== round.current) return
    setPaging(false)
    if (!page) {
      setPagingFailed(true)
      return
    }
    /*
     * 去重按 id：有的平台翻页边界会回一条上一页的最后一条（游标是条数不是
     * 时间段），直接拼会出现两遍。
     */
    setRows((prev) => {
      const seen = new Set(prev.map((row) => row.id))
      return [...prev, ...page.comments.filter((row) => !seen.has(row.id))]
    })
    setCursor(page.cursor)
    setHasMore(page.hasMore)
  }

  return (
    <section className="cmt" aria-label="评论">
      <header className="cmt__head">
        <h3 className="cmt__title">
          <CommentIcon size={15} />
          评论
        </h3>
        {total !== null ? <span className="cmt__count">{total.toLocaleString('zh-CN')}</span> : null}
        <span className="cmt__from">来自 {commentSourceName(track.source)}</span>
      </header>

      {phase === 'loading' ? <p className="cmt__note">正在取评论…</p> : null}
      {phase === 'failed' ? <p className="cmt__note">评论没取到，稍后再试。</p> : null}
      {phase === 'ready' && rows.length === 0 ? (
        <p className="cmt__note">还没有评论。</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="cmt__list">
          {rows.map((comment) => (
            <CommentRow key={comment.id} comment={comment} />
          ))}
        </ul>
      ) : null}

      {pagingFailed ? <p className="cmt__note">下一页没取到，再试一次。</p> : null}
      {phase === 'ready' && hasMore ? (
        <button className="cmt__more" type="button" onClick={() => void loadMore()} disabled={paging}>
          {paging ? '正在取…' : '加载更多'}
        </button>
      ) : null}
    </section>
  )
}
