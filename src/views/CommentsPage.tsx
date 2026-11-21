import { CommentSection } from './CommentSection'
import { canComment } from '../features/comments/api'
import { usePlayer } from '../features/player/store'
import { formatTime } from '../ui/format'

/**
 * 评论页。
 *
 * 评论本来是详情页正文下面的一段。现在给它一个独立页：播放时想看看这首歌大家
 * 怎么说，不必先绕到详情页。只认「正在播的那一首」——这一页没有别的入口。
 *
 * 读不到评论的歌必须自己说一句：CommentSection 对这类轨道返回 null（本机文件
 * 没有评论可读），如果这一页也直接跟着空，用户看到的就只剩一个标题，分不清是
 * 「没有评论」「还在取」还是「这个页面坏了」。
 */
export function CommentsPage() {
  const track = usePlayer((state) => state.current())
  if (!track) {
    return (
      <div className="cmtpage">
        <header className="cmtpage__head">
          <h1 className="cmtpage__title">评论</h1>
        </header>
        <p className="cmtpage__empty">还没有在播的歌。</p>
      </div>
    )
  }
  return (
    <div className="cmtpage">
      <header className="cmtpage__head">
        <div className="cmtpage__meta">
          <h1 className="cmtpage__title">{track.title}</h1>
          <p className="cmtpage__sub">
            {track.artist || '未知艺人'}
            {track.album ? ' · ' + track.album : ''}
            {track.duration > 0 ? ' · ' + formatTime(track.duration) : ''}
          </p>
        </div>
      </header>
      {canComment(track) ? (
        <CommentSection track={track} />
      ) : (
        <p className="cmtpage__empty">
          {track.source === 'local' || !track.onlineId
            ? '本机文件没有可读的评论；同一首歌的在线版本才有。'
            : '这一家还没有接通评论。'}
        </p>
      )}
    </div>
  )
}
