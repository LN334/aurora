import { useEffect, useRef, useState } from 'react'
import type { OnlineComment } from '../env'
import type { Track } from '../types'
import {
  canComment,
  canLikeComment,
  canSendComment,
  commentSourceName,
  fetchComments,
  likeComment,
  sendComment
} from '../features/comments/api'
import { setLoginOpen } from '../features/netease/store'
import { remoteImageUrl } from '../features/player/urls'
import { formatSince } from '../ui/format'
import { Comment as CommentIcon, Heart, User } from '../ui/icons'

/** 每页条数：四家上游都可按页取，20 条正好一屏半，滚动不空。 */
const PAGE_SIZE = 20

/** 和上游一致的字数上限；输入框自己也截一次，省得写满才知道超了。 */
const MAX_LENGTH = 140

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

function CommentRow({
  comment,
  track,
  canLike
}: {
  comment: OnlineComment
  track: Track
  canLike: boolean
}) {
  /*
   * 上游给的是秒（四家接口都是秒，主进程统一过），formatSince 吃毫秒；
   * 没有时间戳的行留空，不编一个「刚刚」出来。
   */
  const when = comment.time ? formatSince(comment.time * 1000) : ''
  /*
   * 赞是本地先动、再对账：点下去立刻变样，上游说不行再退回来并说明原因。
   * 读接口拿不到「我赞过没有」（那要登录态），所以初值一律是没赞。
   */
  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(comment.likes)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  async function toggleLike() {
    if (!canLike || busy) return
    const next = !liked
    setBusy(true)
    setNote('')
    const result = await likeComment(track, comment.id, next)
    setBusy(false)
    if (!result.ok) {
      setNote(result.message)
      return
    }
    setLiked(next)
    setLikes((prev) => Math.max(0, prev + (next ? 1 : -1)))
  }

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
        {canLike || likes > 0 || comment.replies > 0 ? (
          <div className="cmt__stats">
            {canLike ? (
              <button
                className={liked ? 'cmt__stat is-liked' : 'cmt__stat'}
                type="button"
                onClick={() => void toggleLike()}
                disabled={busy}
                aria-pressed={liked}
                title={liked ? '取消赞' : '赞'}
              >
                <Heart size={12} />
                {likes > 0 ? likes.toLocaleString('zh-CN') : '赞'}
              </button>
            ) : likes > 0 ? (
              <span className="cmt__stat">
                <Heart size={12} />
                {likes.toLocaleString('zh-CN')}
              </span>
            ) : null}
            {comment.replies > 0 ? (
              <span className="cmt__stat">{comment.replies.toLocaleString('zh-CN')} 条回复</span>
            ) : null}
          </div>
        ) : null}
        {note ? <p className="cmt__hint is-error">{note}</p> : null}
      </div>
    </li>
  )
}

/**
 * 曲目详情页的评论区。
 *
 * 四个平台各自有一份评论接口，形状已经由主进程收成同一个 CommentPage；
 * 这一页只负责「画一页、再画下一页」，不认平台。本机文件没有可读的评论，
 * 整块不出现，而不是出现一面「暂无评论」的空壁。
 *
 * 写只开放给已经接通的平台：发评论要登录态和逐条签名的写接口，读只要一次
 * 裸 GET。没接通的那几家不画输入框——画一个点了只会说「不支持」的按钮，
 * 比不画更差。
 */
export function CommentSection({ track }: { track: Track }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [rows, setRows] = useState<OnlineComment[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [cursor, setCursor] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [paging, setPaging] = useState(false)
  const [pagingFailed, setPagingFailed] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendNote, setSendNote] = useState('')
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
    setDraft('')
    setSendNote('')
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

  const canSend = canSendComment(track)
  const canLike = canLikeComment(track)

  /**
   * 重新取第一页。
   *
   * 发完评论用它，而不是把新评论插到本地列表头上：上游按时间倒序，刚发的那条
   * 确实在第一页；插出来的那一条没有 id、没有时间，第二次点「加载更多」还会
   * 重复出现。
   */
  async function refresh() {
    const mine = ++round.current
    setPaging(false)
    const page = await fetchComments(track, '', PAGE_SIZE)
    if (mine !== round.current) return
    if (!page) return
    setRows(page.comments)
    setTotal(page.total)
    setCursor(page.cursor)
    setHasMore(page.hasMore)
    setPhase('ready')
  }

  async function submitComment() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setSendNote('')
    const result = await sendComment(track, text)
    setSending(false)
    if (!result.ok) {
      setSendNote(result.message)
      return
    }
    setDraft('')
    await refresh()
  }

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

      {canSend ? (
        <div className="cmt__compose">
          <textarea
            className="cmt__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_LENGTH))}
            placeholder="说点什么…"
            rows={2}
            maxLength={MAX_LENGTH}
            disabled={sending}
            aria-label="写评论"
          />
          <div className="cmt__compose-foot">
            <span className={sendNote ? 'cmt__hint is-error' : 'cmt__hint'}>
              {sendNote || `${draft.length}/${MAX_LENGTH}`}
            </span>
            {sendNote.includes('登录') ? (
              <button className="cmt__link" type="button" onClick={() => setLoginOpen(true)}>
                去登录
              </button>
            ) : null}
            <button
              className="cmt__send"
              type="button"
              onClick={() => void submitComment()}
              disabled={sending || !draft.trim()}
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'loading' ? <p className="cmt__note">正在取评论…</p> : null}
      {phase === 'failed' ? <p className="cmt__note">评论没取到，稍后再试。</p> : null}
      {phase === 'ready' && rows.length === 0 ? (
        <p className="cmt__note">还没有评论。</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="cmt__list">
          {rows.map((comment) => (
            <CommentRow key={comment.id} comment={comment} track={track} canLike={canLike} />
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
