import { CommentSection } from './CommentSection'
import { usePlayer } from '../features/player/store'
import { formatTime } from '../ui/format'

/**
 * 评论页。
 *
 * 评论本来是详情页正文下面的一段。现在给它一个独立页：播放时想看看这首歌大家
 * 怎么说，不必先绕到详情页。只认「正在播的那一首」——这一页没有别的入口。
 *
 * 本机文件通常没有评论可读（CommentSection 自己返回空态），不在这里另判一次。
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
      <CommentSection track={track} />
    </div>
  )
}
