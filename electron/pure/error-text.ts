/**
 * 把一个「抛出来的东西」变成一句能给人看的话。
 *
 * 以前每个平台各写一遍 `error instanceof Error ? error.message : String(error)`，
 * 而最后那个 String() 是个坑：上游/网络层抛的不一定是 Error——axios 的拒绝值、
 * 自定义的 `{ code, message }`、甚至一个普通对象。对它们 String() 只得到
 * "[object Object]"，这句话会一路被带到右下角的提示里，用户看到的就是一条
 * 什么都没说的报错。
 *
 * 顺序：Error.message → 对象的 message 字段 → 信封里那句人话 → 对象的 JSON
 * → 原样字符串。全都不成时给「未知错误」，也不给 "[object Object]"。
 */

/**
 * 上游把真正的说法包在一层信封里：`{ status: 502, body: { code, msg }, cookie }`。
 *
 * 直接把这坨 stringify 出来，提示条上就是一屏花括号——用户看不出发生了什么。
 * 拆开取内层那句话；网易云还会在 `data.dialog.title` 里写明是哪一类拦截
 * （例如「风险提示」），它比「评论发布失败，请稍后重试」更说明问题，所以拼在
 * 前面。信封里什么都没有才交回给上层走 JSON。
 */
function envelopeText(record: Record<string, unknown>): string {
  const body = record.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ''
  const inner = body as Record<string, unknown>
  const msg =
    typeof inner.message === 'string' && inner.message
      ? inner.message
      : typeof inner.msg === 'string'
        ? inner.msg
        : ''
  const data = inner.data && typeof inner.data === 'object' ? (inner.data as Record<string, unknown>) : null
  const dialog =
    data && data.dialog && typeof data.dialog === 'object' ? (data.dialog as Record<string, unknown>) : null
  const title = dialog && typeof dialog.title === 'string' ? dialog.title : ''
  if (title && msg && title !== msg) return `${title}：${msg}`
  return msg || title
}
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || '未知错误'
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message : ''
    if (message) return message
    const wrapped = envelopeText(record)
    if (wrapped) return wrapped
    try {
      const json = JSON.stringify(error)
      if (json && json !== '{}') return json
    } catch {
      /* 循环引用之类：落到下面那句 */
    }
    return '未知错误'
  }
  if (error === null || error === undefined) return '未知错误'
  return String(error)
}
