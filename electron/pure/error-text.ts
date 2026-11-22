/**
 * 把一个「抛出来的东西」变成一句能给人看的话。
 *
 * 以前每个平台各写一遍 `error instanceof Error ? error.message : String(error)`，
 * 而最后那个 String() 是个坑：上游/网络层抛的不一定是 Error——axios 的拒绝值、
 * 自定义的 `{ code, message }`、甚至一个普通对象。对它们 String() 只得到
 * "[object Object]"，这句话会一路被带到右下角的提示里，用户看到的就是一条
 * 什么都没说的报错。
 *
 * 顺序：Error.message → 对象的 message 字段 → 对象的 JSON → 原样字符串。
 * 全都不成时给「未知错误」，也不给 "[object Object]"。
 */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || '未知错误'
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = typeof record.message === 'string' ? record.message : ''
    if (message) return message
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
