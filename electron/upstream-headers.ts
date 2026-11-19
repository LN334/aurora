/**
 * 拉上游媒体时该带的请求头。
 *
 * 有的图床与 CDN 按 UA、来源站防盗链：汽水的封面挂在 douyinpic 上，B 站的
 * CDN 校验来源站，光带 Range 过去一律 403。页面侧走主进程代理时是这一套，
 * 一起听里房主替客人代拉时也必须用同一套——否则平台看到的是一个没有来源的
 * 请求，转发出去就是 403。
 */

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

export function upstreamHeaders(target: string, range: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'user-agent': BROWSER_USER_AGENT }
  try {
    const host = new URL(target).hostname
    if (host.endsWith('douyinpic.com') || host.endsWith('douyincdn.com')) {
      headers.referer = 'https://www.douyin.com/'
    }
    /*
     * B 站的 CDN 与图床都校验来源站：音频缺 Referer 一律 403，封面则变成空卡。
     * 镜像节点是新域名（bilivideo.cn/bilivideo.com），故一并按后缀认。
     */
    if (
      host.endsWith('bilivideo.com') ||
      host.endsWith('bilivideo.cn') ||
      host.endsWith('hdslb.com') ||
      host.endsWith('bilibili.com')
    ) {
      headers.referer = 'https://www.bilibili.com/'
    }
  } catch {
    /* 解析不了的地址交给后面的 fetch 去报错 */
  }
  if (range) headers.range = range
  return headers
}
