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

/** 链接：`aurora://join?h=…&c=…`。参数名不挑，顺序也不挑。 */
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
   * 我们自己只发 h 与 c，但读的时候 address / code 这两种写法也该认。
   */
  const pick = (names: string[]): string => {
    for (const name of names) {
      const value = url.searchParams.get(name)
      if (value && value.trim()) return value.trim()
    }
    return ''
  }
  const place = bare(pick(['h', 'host', 'address', 'addr', 'a']))
  const code = normalizeCode(pick(['c', 'code', 'room', 'r']))
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
  /* 冒号与斜杠都还原：`wss://域名` 写成 `wss%3A%2F%2F域名` 会让人以为链接坏了。 */
  const query = new URLSearchParams({ h: place, c: code })
    .toString()
    .replace(/%3A/gi, ':')
    .replace(/%2F/gi, '/')
  return 'aurora://join?' + query
}

/** 聊天软件里更稳的那一行：地址 + 房间码，手抄也不会错位。 */
export function inviteText(place: string, code: string): string {
  return [place, code].filter(Boolean).join(' ')
}
