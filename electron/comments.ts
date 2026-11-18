/**
 * 评论的共享形状。
 *
 * 四个平台的评论接口彼此没有关系（网易云的 `comment_music`、QQ 的 commentlist、
 * 酷狗的 `mcomment`、汽水的 `/luna/pc/comments`），字段名从 `rootcommentcontent`
 * 到 `count_digged` 全不一样。页面只该看到一种形状，所以每个客户端在自己那一层
 * 翻成这里的两个接口，渲染层一行平台判断都不用写。
 */

export interface OnlineComment {
  /** 上游的评论 id。字符串：汽水的 id 超出安全整数。 */
  id: string
  author: string
  avatar: string | null
  text: string
  likes: number
  replies: number
  /** 发表时间，秒级 Unix；上游没给就是 null。 */
  time: number | null
  /** 上游标了热门/精选（各平台含义不同，只用来加一枚小标签）。 */
  featured: boolean
}

export interface CommentPage {
  comments: OnlineComment[]
  /** 上游报的总数；没报就是 null——显示成「0 条」会是假话。 */
  total: number | null
  hasMore: boolean
  /** 下一页游标。各平台含义不同（offset / 页码 / cursor），空串表示没有下一页。 */
  cursor: string
}

// --- 未信响应读取器 -------------------------------------------------------

export function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 标识符：字符串原样（trim），数字转十进制字符串。
 *
 * 酷狗把评论 id 写成数字，别的平台是字符串；两种都收，但不用 Number 中转——
 * 汽水的 id 有 19 位，超出安全整数后会变成另一个数。
 */
export function asId(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  return ''
}

export function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * 时间戳归一到秒。
 *
 * 网易云和 QQ 给毫秒，酷狗和汽水给秒，酷狗还有一半给的是「2024-04-30 07:29:18」
 * 这种字符串（北京时间，无时区标记）。写在这里是为了让页面只面对一种单位——
 * 渲染层按秒乘 1000 画日期。
 */
export function asSeconds(value: unknown): number | null {
  const numeric = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value
  if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1e12 ? Math.round(numeric / 1000) : Math.round(numeric)
  }
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const stamp = Date.parse(
    match[1] + '-' + match[2] + '-' + match[3] + 'T' + match[4] + ':' + match[5] + ':' + match[6] + '+08:00'
  )
  return Number.isFinite(stamp) ? Math.round(stamp / 1000) : null
}

/** 一页空评论：上游说「没有」，不是「失败」。 */
export function emptyPage(): CommentPage {
  return { comments: [], total: null, hasMore: false, cursor: '' }
}
