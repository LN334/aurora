/**
 * 一起听的邀请串。
 *
 * 一条邀请里只有两样东西：房主的地址（`192.168.1.5:7890`，走公网时是隧道域名）
 * 和房间码。Aurora 没有服务端，换不到短链接，所以链接只能原样装着这两样。
 * 能做的只有让它耐折腾——聊天软件转一道、中间被空格拆开、粘贴时前后带雾，
 * 都还认得出来。
 *
 * 放在这里而不是页里：主进程那边的邀请参数最终也走这一份解析，两处规则
 * 分开写，迟早会出现「主进程认、页面不认」这种事。
 */

interface ParsedInvite {
  /** 房主地址；空串表示这一段没认出来。 */
  place: string
  /** 房间码（大写）；空串表示这一段没认出来。 */
  code: string
}

/**
 * 房间码归一。
 *
 * 大写、去掉 `-` 与空格这类手念时加的分隔符，最多 8 位。房主念的时候习惯
 * 加个连字符（`ABC-DEF`），照原样拿去比对就永远对不上。
 */
export function normalizeCode(raw: string): string {
  return raw.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, 8)
}

/**
 * 剥掉「可以省略」的协议与尾部斜杠：`ws://1.2.3.4:7890/` → `1.2.3.4:7890`。
 *
 * `wss://` 不剥。它不是装饰：ws:// 走 80、wss:// 走 443，剥掉之后客人会去连
 * 80 口，而节点对裸域名一律回 503。安全与否必须一路带到握手为止。
 */
function bare(value: string): string {
  return value.replace(/^(?:ws|https?):\/\//i, '').replace(/\/+$/, '')
}

/** `wss://域名` 这种「没有端口但有协议」的地址。 */
function isSecurePlace(value: string): boolean {
  return /^wss:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i.test(value)
}

/** 地址长这样：`1.2.3.4:7890`、`demo.natfrp.cloud:23456`、`localhost:3000`。 */
function looksLikePlace(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9-]+:\d{1,5}$/i.test(value)
}

/**
 * 链接：`aurora://join/房间码?host=主机&secure=1`。
 *
 * 房间码走路径、主机与协议走查询——和常见的分享链接一个样子（Discord 的
 * `discord.gg/邀请码` 就是这个结构）。参数名也写全，别用 h/c/s 这种缩写：
 * 这条链接要发给人看，看得懂比省两个字符重要。
 *
 * 老格式（`?h=…&c=…&s=1`，甚至 h 里直接写 wss://）继续认，已经发出去的不废。
 */
function parseLink(text: string): ParsedInvite | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'aurora:') return null
  /*
   * 参数名放宽是有理由的：链接可能由别人手拼，也可能来自以后手机端。
   * 我们自己只发 host / secure 与路径里的房间码，但读的时候老写法也该认。
   */
  const pick = (names: string[]): string => {
    for (const name of names) {
      const value = url.searchParams.get(name)
      if (value && value.trim()) return value.trim()
    }
    return ''
  }
  const rawPlace = pick(['host', 'h', 'address', 'addr', 'a'])
  /*
   * 协议由 secure=1 表示，不塞进 host：链接里摞一个完整网址，聊天软件与浏览器
   * 会在第二个 :// 处断开，&c= 之后全丢。
   */
  const secure =
    /^(1|true|wss)$/i.test(pick(['secure', 's'])) || /^wss:\/\//i.test(rawPlace)
  const host = bare(rawPlace).replace(/^wss?:\/\//i, '')

  let pathCode = ''
  try {
    pathCode = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    pathCode = ''
  }
  const place = secure && host ? 'wss://' + host : host
  const code = normalizeCode(pick(['c', 'code', 'room', 'r']) || pathCode)
  if (!place && !code) return null
  return { place, code }
}

/**
 * 从一段粘贴文本里认出「地址 + 房间码」。
 *
 * 认两种：完整链接，和「地址 房间码」这一行——后者是房主口头念完、对方
 * 照着敲的样子。两样都认不出来时返回 null，界面据此说一句「没认出」，
 * 而不是把半截东西当地址塞进去然后连不上。
 *
 * 只认出一样也返回：地址格或码格是分开填的，补哪一格由界面决定。
 */
export function parseInvite(raw: string): ParsedInvite | null {
  const text = raw.trim()
  if (!text) return null
  if (/^aurora:/i.test(text)) return parseLink(text)

  const parts = text.split(/[\s,;|，；、]+/).filter(Boolean)
  let place = ''
  let code = ''
  for (const part of parts) {
    const value = bare(part)
    if (!place && (looksLikePlace(value) || isSecurePlace(value))) {
      place = value
      continue
    }
    /*
     * 房间码只在「不是地址」的那一段里找：`10.0.0.2:30` 去掉标点后也是一串
     * 字母数字，不挡住的话它会被当成一个 7 位房间码。
     */
    if (!code && !/[.:]/.test(value)) {
      const candidate = normalizeCode(value)
      if (candidate.length >= 4 && candidate.length <= 8) code = candidate
    }
  }
  if (!place && !code) return null
  return { place, code }
}

/**
 * 一条能点开的邀请链接。
 *
 * 冒号留在原样：这条链接是要发给人看的，`%3A` 只会让收到的人怀疑自己复制坏了。
 * 冒号在查询串里本来就合法，不必编码。
 */
export function inviteLink(place: string, code: string): string {
  /*
   * 一条标准形状的邀请链接：
   *
   *   aurora://join/ABC123?host=demo.trycloudflare.com&secure=1
   *
   * 房间码在路径里、主机在查询里。不要写成 `?h=…&c=…`：缩写没人看得懂；更不要
   * 把 `wss://` 整个塞进参数——那样链接里会出现第二个 ://，系统解析到那里就断，
   * 后面的房间码全丢，点开是死的。
   */
  const secure = /^wss:\/\//i.test(place)
  const host = place.replace(/^wss:\/\//i, '')
  const params = new URLSearchParams()
  if (host) params.set('host', host)
  if (secure) params.set('secure', '1')
  const query = params.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/')
  const room = encodeURIComponent(code)
  return 'aurora://join/' + room + (query ? '?' + query : '')
}

/**
 * 落地页链接：分享用的 https 版本。
 *
 * `aurora://` 不是标准协议，微信、QQ、浏览器都不会把它识别成网址——发出去就是
 * 一段点不动的灰字。https 链接哪儿都能点，落地页上再给「打开 Aurora」与「复制
 * 地址+房间码」两条路：前者一步进房，后者在拦自定义协议的内置浏览器里兜底。
 */
const LANDING_BASE = 'https://ln334.github.io/aurora/join/'

export function landingLink(place: string, code: string): string {
  const secure = /^wss:\/\//i.test(place)
  const host = place.replace(/^wss:\/\//i, '')
  const params = new URLSearchParams()
  if (code) params.set('c', code)
  if (host) params.set('host', host)
  if (secure) params.set('secure', '1')
  const query = params.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/')
  return LANDING_BASE + (query ? '?' + query : '')
}

/** 聊天软件里更稳的那一行：地址 + 房间码，手抄也不会错位。 */
export function inviteText(place: string, code: string): string {
  return [place, code].filter(Boolean).join(' ')
}
