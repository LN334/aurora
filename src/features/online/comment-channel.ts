import type { CommentPage, CommentWriteResult } from '../../env'
import { askProvider, warnChannel } from './channel-core.ts'
import type { ProviderId } from './types.ts'

/**
 * 评论：读一页、发一条、赞一条。
 *
 * 和喜欢那一支的取舍不同：读失败折 null（页面据此不画评论墙，与旧的 try/catch
 * 一致），写失败折一句人话（主进程给的句子更准，但通道层拿到的只有一个错误码，
 * 不能把它当话给用户看）。「这家平台有没有这条通道」由能力表判断，不在这里。
 */

/** 一页评论。读不到给 null——「没有评论」是 comments 为空、total 为 0 的那一页。 */
export async function providerComments<T extends CommentPage>(
  provider: ProviderId,
  songId: string | number,
  cursor = '',
  limit = 20
): Promise<T | null> {
  const answer = await askProvider<T | null>(provider, 'comments', { songId, cursor, limit })
  if (!answer.ok) {
    warnChannel(provider, 'comments', answer.why)
    return null
  }
  return answer.value ?? null
}

/** 发一条评论。成功与否连同主进程给的句子一起回来。 */
export async function providerCommentSend(
  provider: ProviderId,
  songId: string | number,
  content: string
): Promise<CommentWriteResult> {
  const answer = await askProvider<CommentWriteResult>(provider, 'commentSend', { songId, content })
  if (!answer.ok) {
    warnChannel(provider, 'commentSend', answer.why)
    return { ok: false, message: '没发出去，稍后再试' }
  }
  return answer.value ?? { ok: false, message: '没发出去，稍后再试' }
}

/** 赞 / 取消赞一条评论。 */
export async function providerCommentLike(
  provider: ProviderId,
  songId: string | number,
  commentId: number,
  liked: boolean
): Promise<CommentWriteResult> {
  const answer = await askProvider<CommentWriteResult>(provider, 'commentLike', {
    songId,
    commentId,
    liked
  })
  if (!answer.ok) {
    warnChannel(provider, 'commentLike', answer.why)
    return { ok: false, message: '没点上，稍后再试' }
  }
  return answer.value ?? { ok: false, message: '没点上，稍后再试' }
}
