import type { NeteaseFailureReason } from '../netease/reasons'

/**
 * 酷狗为什么放不出来，以及告诉用户什么。
 *
 * 词汇表与网易云/QQ 共用（渲染层只认一套原因），文案不共用：酷狗用户不该
 * 被告知去查 QQ 的账号。文件里没有任何运行时 import，`node --test` 能直接
 * 加载它——别加 import。
 *
 * 为什么不把它说成「已下架」：酷狗当前对未登录请求一律答
 * `errcode:20028 / error:'本次请求需要验证'`（实测四种入参组合都一样），
 * 那是**权限**问题，不是曲目消失。把权限问题写成「已下架」会让用户以为
 * 歌没了，而不是「登录一下就能放」。
 */

export type KugouFailureReason = NeteaseFailureReason

interface KugouStreamFailureInput {
  /** 调用本身抛了（传输层失败：进程没起、超时、非 JSON）。 */
  error?: unknown
  /** 上游的 `errcode`/`err_code`；`20028` 是「本次请求需要验证」。 */
  errcode?: number | null
  /** 上游的 `status`；`2` 与 `20028` 一起出现表示被拦。 */
  status?: number | null
  /** 上游自己的 `error`/`message` 文本，原样保留给界面。 */
  upstreamMessage?: string
  /** 拿到的播放地址；有地址就是成功，压根不进这里。 */
  url?: string | null
  /** 这次请求是否带着登录 cookie。 */
  loggedIn?: boolean
}

/**
 * 把一次失败的取流归到共享原因上。
 *
 * 已知码只有 `20028`（需要验证）是实测的，其余一律 `unknown`——猜一个具体原因
 * 比说「不知道」更糟，因为界面会照着原因给出错误的建议。
 */
export function classifyStreamFailure(input: KugouStreamFailureInput): KugouFailureReason {
  if (input.error) return 'network'
  if (input.url) return 'unknown'

  const text = (input.upstreamMessage ?? '').toLowerCase()
  const errcode = input.errcode ?? null

  // 20028 有两种读法，区别在于有没有登录：没登录时它是「先登录」，登录后还是
  // 它，就说明不是账号问题，如实说接口暂时不可用，别断言成会员限制。
  if (errcode === 20028 || /需要验证|check r failed|请先登录/.test(text)) {
    return input.loggedIn ? 'service-unavailable' : 'login-required'
  }
  if (/登录/.test(text)) return 'login-required'
  if (/会员|vip/.test(text)) return 'vip-required'
  if (/下架|不存在|not found/.test(text)) return 'taken-down'
  if (/频繁|too many|rate/.test(text)) return 'rate-limited'
  return 'unknown'
}

/** 原因对应的中文文案（渲染层也会覆写，这里是兜底）。 */
export function describeFailure(reason: KugouFailureReason): string {
  switch (reason) {
    case 'login-required':
      return '这首歌需要登录酷狗账号后才能获取播放地址'
    case 'vip-required':
      return '这首歌需要酷狗会员'
    case 'region-limited':
      return '这首歌在当前地区不能播放'
    case 'trial-only':
      return '只能试听片段'
    case 'taken-down':
      return '这首歌已经不在了'
    case 'rate-limited':
      return '请求太频繁，稍后再试'
    case 'service-unavailable':
      return '酷狗接口暂时不可用'
    case 'network':
      return '网络不通，没连上酷狗接口'
    case 'unknown':
    default:
      return '酷狗没有给出可播放的地址'
  }
}
