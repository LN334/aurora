import { isNative } from '../../bridge'
import type { CommentPage, CommentWriteResult } from '../../env'
import type { Track } from '../../types'

/**
 * 评论区取数：曲目详情页唯一的口子。
 *
 * 四个平台各自有一条读评论的 IPC 通道，而页面只认「这一行是哪家的歌」。
 * 把分发放在这里而不是页面里，是为了让页面不知道四家接口的差别——它拿到的
 * 永远是同一个 CommentPage，cursor 是不是页码也由平台自己解释。
 *
 * 本机文件没有评论可读：返回 null，页面据此整块不画，而不是画一面空壁。
 */

/** 能读评论的四个平台。离线源（本地文件）不在其中。 */
const COMMENT_SOURCES = ['netease', 'qq', 'kugou', 'qishui'] as const

/** 这条轨道有没有评论可读。页面挂载前先问一次，省一次空请求。 */
export function canComment(track: Track): boolean {
  if (!track.onlineId) return false
  return (COMMENT_SOURCES as readonly string[]).includes(track.source ?? '')
}

/**
 * 取一页评论。
 *
 * cursor 由上一页原样带回，首屏传空串；limit 是每页条数。返回 null 表示
 * 这家平台读不到（浏览器预览、旧构建、接口失败），而不是「没有评论」——
 * 后者是 comments 为空、total 可能为 0 的 CommentPage。
 */
export async function fetchComments(
  track: Track,
  cursor = '',
  limit = 20
): Promise<CommentPage | null> {
  if (!isNative) return null
  const id = track.onlineId
  if (!id) return null
  const api = window.aurora
  try {
    switch (track.source) {
      case 'netease':
        return (await api?.netease?.comments(id, cursor, limit)) ?? null
      case 'qq':
        return (await api?.qq?.comments(id, cursor, limit)) ?? null
      case 'kugou':
        return (await api?.kugou?.comments(id, cursor, limit)) ?? null
      case 'qishui':
        return (await api?.qishui?.comments(id, cursor, limit)) ?? null
      default:
        return null
    }
  } catch {
    // 通道不存在（旧 preload）或主进程抛错：页面按「读不到」处理。
    return null
  }
}

/**
 * 哪些平台已经能写。
 *
 * 发评论和点赞分开列：酷狗有发评论的接口但没有点赞的接口，一家平台写得上
 * 不代表另一件事也能做。没列进来的平台，界面就不画那枚按钮——画一个点了
 * 只会说「不支持」的按钮，比不画更差。
 */
const SEND_SOURCES = ['netease', 'qq', 'kugou'] as const
const LIKE_SOURCES = ['netease'] as const

/** 这首歌能不能发评论。 */
export function canSendComment(track: Track): boolean {
  if (!isNative || !track.onlineId) return false
  return (SEND_SOURCES as readonly string[]).includes(track.source ?? '')
}

/** 这首歌的评论能不能点赞。 */
export function canLikeComment(track: Track): boolean {
  if (!isNative || !track.onlineId) return false
  return (LIKE_SOURCES as readonly string[]).includes(track.source ?? '')
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
  if (!isNative) return refused('浏览器预览模式不能发评论')
  const id = track.onlineId
  if (!id) return refused('这首歌没有平台 ID')
  try {
    switch (track.source) {
      case 'netease':
        return (await window.aurora?.netease?.commentSend(id, text)) ?? refused('没有回应')
      case 'qq':
        return (await window.aurora?.qq?.commentSend(id, text)) ?? refused('没有回应')
      case 'kugou':
        return (await window.aurora?.kugou?.commentSend(id, text)) ?? refused('没有回应')
      default:
        return refused(commentSourceName(track.source) + '还不支持发评论')
    }
  } catch {
    return refused('没发出去，稍后再试')
  }
}

/**
 * 赞 / 取消赞一条评论。
 *
 * 评论 id 在页面上是字符串（汽水会超安全整数），但网易云这条通道收数字：
 * 转不过去就直说，不要拿一个 NaN 去问上游。
 */
export async function likeComment(
  track: Track,
  commentId: string,
  liked: boolean
): Promise<CommentWriteResult> {
  if (!isNative) return refused('浏览器预览模式不能点赞')
  const id = track.onlineId
  if (!id) return refused('这首歌没有平台 ID')
  try {
    switch (track.source) {
      case 'netease': {
        const numeric = Number(commentId)
        if (!Number.isSafeInteger(numeric)) return refused('评论 ID 无效')
        return (await window.aurora?.netease?.commentLike(id, numeric, liked)) ?? refused('没有回应')
      }
      default:
        return refused(commentSourceName(track.source) + '还不支持点赞')
    }
  } catch {
    return refused('没点上，稍后再试')
  }
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
