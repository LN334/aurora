/**
 * 导出日志前的脱敏。
 *
 * 单独放在 pure/ 下有两个原因：它是不碰文件也不碰 electron 的纯函数，
 * `node --test` 能直接跑；而 `electron/diagnostics.ts` 一 import electron 就跑不起来，
 * 脱敏这种「错了会泄露凭据」的规则不能只靠手测。
 */

/** 这些模式命中就替换成 ***；顺序有意义，先长后短。 */
const SCRUBS: Array<[RegExp, string]> = [
  // Authorization: Bearer xxx / "authorization":"xxx"
  [/(authorization["'\s:=]*)(bearer\s+)?[A-Za-z0-9._~+/=-]{16,}/gi, '$1***'],
  // token=xxx & cookie=xxx 这类查询串
  [/((?:token|password|passwd|pwd|cookie|skey|secret|access[_-]?key|sign)=)[^&\s"'，,;]{6,}/gi, '$1***'],
  // JSON 里的 "password":"xxx"
  [/("(?:token|password|cookie|skey|secret|authorization)"\s*:\s*)"[^"]*"/gi, '$1"***"'],
  // 房间转发令牌：/stream/<16 位以上的随机串>
  [/(\/stream\/)[A-Za-z0-9%._~-]{16,}/g, '$1***']
]

export function scrub(text: string): string {
  let out = text
  for (const [pattern, replacement] of SCRUBS) out = out.replace(pattern, replacement)
  return out
}
