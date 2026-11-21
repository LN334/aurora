/**
 * 封面地址的拆解。
 *
 * 抽成纯函数是因为这里出过一次真 bug：`artworkFor()` 返回的是**带尺寸段**的
 * 包装地址（`aurora-remote://image/n1000/http%3A%2F%2F…`），而调用方只想拿到
 * 上游原始 URL 再按自己的尺寸重包。把 `aurora-remote://image/` 剥掉之后，剩下
 * 的是 `n1000/http%3A%2F%2F…`——那不是一个 http 地址，于是调用方把整串当图片
 * 地址用，浏览器按相对路径解析成 `aurora-app://app/n200/n1000/http://…`，
 * 主进程拿它去 asar 里找文件，日志里就是一串 `404 stat failed`，界面上是
 * 一片封面变成色块。
 */

const REMOTE_PREFIX = 'aurora-remote://image/'
const SIZE_SEGMENT = /^n\d{2,4}\//
const HTTP = /^https?:/i

/**
 * 从 `artworkFor()` 给回来的地址里取上游原始 URL。
 *
 * - `aurora-remote://image/n1000/<encoded>` → `<decoded>`（已经是 http 就是原样）
 * - `aurora-media://…`（本机封面）原样返回：主进程的代理只转 http(s)，递自定义
 *   协议进去只会换回 400。
 * - 取不出 http 地址时返回 null，调用方据此退回图标，而不是拿一个坏地址去 404。
 */
export function upstreamOfArtwork(art: string | null | undefined): string | null {
  if (!art) return null
  let inner = art
  if (inner.startsWith(REMOTE_PREFIX)) {
    inner = inner.slice(REMOTE_PREFIX.length)
    /* 尺寸段可能不止一层：包装回包装时见过 `n200/n1000/…`。 */
    while (SIZE_SEGMENT.test(inner)) inner = inner.replace(SIZE_SEGMENT, '')
    try {
      inner = decodeURIComponent(inner)
    } catch {
      return null
    }
  }
  if (HTTP.test(inner)) return inner
  return null
}

/** 本机曲目的封面是自定义协议，页面可以直接用，不必过代理。 */
export function isLocalArtwork(art: string | null | undefined): boolean {
  if (!art) return false
  const inner = art.startsWith(REMOTE_PREFIX) ? art.slice(REMOTE_PREFIX.length) : art
  return /^aurora-media:/i.test(inner) || /^aurora-media:/i.test(inner.replace(/^n\d{2,4}\//, ''))
}
