/**
 * URL builders for the private media scheme.
 *
 * Kept in their own module with no imports so both the audio engine and the
 * library-source layer can use them without a circular dependency.
 */

export const MEDIA_SCHEME = 'aurora-media'

/**
 * Stream URL for a local audio file.
 *
 * The path is fully percent-encoded and placed in a single path segment, which
 * avoids the ambiguity of putting a Windows drive letter into a URL path.
 */
export function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(filePath)}`
}

/** Cover art for a track, resolved main-side (embedded tag, then folder image). */
export function artUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://art/${encodeURIComponent(filePath)}`
}

/**
 * The scheme for media that lives on someone else's server.
 *
 * Online audio and artwork cannot be pointed at directly: the production CSP
 * allows no external origins, and the engine routes its element through Web
 * Audio, which silences any source the page is not allowed to read. Both the
 * audio element and the artwork therefore ask the main process for a
 * same-origin URL, and the main process fetches the upstream address with
 * Range support. The upstream URL is encoded into a single path segment so no
 * query string, fragment or ampersand in it can be mistaken for a parameter of
 * our own.
 */
export const REMOTE_SCHEME = 'aurora-remote'

/** Proxy URL for an upstream audio stream. */
export function remoteStreamUrl(upstream: string): string {
  return `${REMOTE_SCHEME}://stream/${encodeURIComponent(upstream)}`
}

/** Proxy URL for an upstream image (cover art). */
export function remoteImageUrl(upstream: string): string {
  return `${REMOTE_SCHEME}://image/${encodeURIComponent(upstream)}`
}

/**
 * 按显示尺寸向图片 CDN 要缩放版。
 *
 * 网易云的图床支持 `?param=WxY`：同一张封面原图 800KB，200×200 只有 39KB，
 * 解码成位图后的差距是 4MB 对 160KB。卡片和头像本来就只显示一两百像素，
 * 拿原图既不快也占内存。非网易云域名原样返回，免得给别人的 CDN 加怪参数。
 */
export function sizedImage(upstream: string, px: number): string {
  try {
    const url = new URL(upstream)
    if (!/(^|\.)music\.126\.net$/.test(url.hostname)) return upstream
    url.searchParams.set('param', `${px}y${px}`)
    return url.toString()
  } catch {
    return upstream
  }
}
