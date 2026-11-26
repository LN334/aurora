import type { CommentPage, CommentWriteResult } from '../../env'
import type { Track } from '../../types'
import { supportsCapability } from '../online/capability.ts'
import { providerCommentLike, providerCommentSend, providerComments } from '../online/comment-channel.ts'
import { getProvider } from '../online/registry'
import type { ProviderId } from '../online/types'

/**
 * 评论区取数：曲目详情页唯一的口子。
 *
 * 页面只认「这一行是哪家的歌」。哪几家能读、能发、能赞，由平台自己的能力表
 * 说——这里不列名单。名单会与实现走散（曾经就散过：B 站声明能登录却没有登录
 * 方法，界面因此留了一个按不动的入口）。
 *
 * 本机文件没有评论可读：返回 null，页面据此整块不画，而不是画一面空壁。
 */

/** 这家平台有没有那条评论通道。离线源（本地文件）根本不在注册表里。 */
function commentProvider(track: Track): ProviderId | null {
  if (!track.onlineId) return null
  const provider = getProvider(track.source as ProviderId)
  if (!provider || !provider.available()) return null
  return provider.id
}

/** 这条轨道有没有评论可读。页面挂载前先问一次，省一次空请求。 */
export function canComment(track: Track): boolean {
  const provider = getProvider(track.source as ProviderId)
  return Boolean(track.onlineId && provider && provider.available()) && supportsCapability(provider, 'comments')
}

/**
 * 取一页评论。
 *
 * cursor 由上一页原样带回，首屏传空串；limit 是每页条数。返回 null 表示
 * 读不到（浏览器预览、通道没接、接口失败），而不是「没有评论」——后者是
 * comments 为空、total 可能为 0 的 CommentPage。
 */
export async function fetchComments(
  track: Track,
  cursor = '',
  limit = 20
): Promise<CommentPage | null> {
  const provider = commentProvider(track)
  const id = track.onlineId
  if (!provider || !id) return null
  return await providerComments<CommentPage>(provider, id, cursor, limit)
}

/** 这首歌能不能发评论。 */
export function canSendComment(track: Track): boolean {
  const provider = getProvider(track.source as ProviderId)
  return Boolean(track.onlineId && provider && provider.available()) && supportsCapability(provider, 'commentSend')
}

/** 这首歌的评论能不能点赞。 */
export function canLikeComment(track: Track): boolean {
  const provider = getProvider(track.source as ProviderId)
  return Boolean(track.onlineId && provider && provider.available()) && supportsCapability(provider, 'commentLike')
}

function refused(message: string): CommentWriteResult {
  return { ok: false, message }
}

/**
 * 发一条评论。
 *
 * 失败的句子由主进程给（「登录网易云后才能发评论」「最多 140 字」），这里只
 * 补上「这家平台还没做」这种页面才知道的情况。
 */
export async function sendComment(track: Track, text: string): Promise<CommentWriteResult> {
  const provider = commentProvider(track)
  const id = track.onlineId
  if (!provider || !id) return refused('这首歌没有平台 ID')
  if (!supportsCapability(getProvider(provider), 'commentSend')) {
    return refused(commentSourceName(track.source) + '还不支持发评论')
  }
  return await providerCommentSend(provider, id, text)
}

/**
 * 赞 / 取消赞一条评论。
 *
 * 评论 id 在页面上是字符串（汽水会超安全整数），但通道收数字：转不过去就
 * 直说，不要拿一个 NaN 去问上游。
 */
export async function likeComment(
  track: Track,
  commentId: string,
  liked: boolean
): Promise<CommentWriteResult> {
  const provider = commentProvider(track)
  const id = track.onlineId
  if (!provider || !id) return refused('这首歌没有平台 ID')
  if (!supportsCapability(getProvider(provider), 'commentLike')) {
    return refused(commentSourceName(track.source) + '还不支持点赞')
  }
  const numeric = Number(commentId)
  if (!Number.isSafeInteger(numeric)) return refused('评论 ID 无效')
  return await providerCommentLike(provider, id, numeric, liked)
}

/** 该平台的显示名，页头写「来自网易云」用。 */
export function commentSourceName(source: string | undefined): string {
  switch (source) {
    case 'netease':
      return '网易云音乐'
    case 'qq':
      return 'QQ 音乐'
    case 'kugou':
      return '酷狗音乐'
    case 'qishui':
      return '汽水音乐'
    default:
      return ''
  }
}
