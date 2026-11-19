import QRCode from 'qrcode'
import { write } from '../startup-log'
import { clearCookie, readCookie, writeCookie } from './session'

/**
 * B 站扫码登录。
 *
 * 流程与另外四家一样：出码、轮询、拿到凭据。区别在两处——B 站的二维码接口只给
 * 一个登录页地址，图得自己画（`qrcode` 包）；凭据在 `Set-Cookie` 里，不在响应
 * 体里，所以轮询这一路要读响应头而不是 JSON。
 *
 * 登录之后不改变「B 站是不是音乐平台」这件事：它仍然只有搜索与播放。登录换来
 * 的是搜索接口放过人机验证的概率，以及更高档的音轨。
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const REFERER = 'https://www.bilibili.com/'

/** 登录成功后要留下的那几个键；其余（如 buvid 系列的游客值）由指纹那一路自己管。 */
const KEEP_COOKIE = /^(SESSDATA|bili_jct|DedeUserID|DedeUserID__ckMd5|sid)=/

let activeProfile = 'default'

export function setLoginProfile(profileId: string): void {
  activeProfile = profileId
}

/** 这一路请求要带的账号 cookie；未登录是空串。 */
export function accountCookie(): string {
  return readCookie(activeProfile)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function fail(label: string, error: unknown): void {
  write('bilibili:' + label + ' 失败 ' + (error instanceof Error ? error.message : String(error)))
}

/** 出一个登录二维码。拿不到就回空 key，界面据此显示失败而不是一直转。 */
export async function qrCreate(): Promise<{ key: string; imageDataUrl: string }> {
  try {
    const response = await fetch(
      'https://passport.bilibili.com/x/passport-login/web/qrcode/generate?source=main-fe-header',
      {
        headers: { 'User-Agent': USER_AGENT, Referer: REFERER },
        signal: AbortSignal.timeout(12000)
      }
    )
    const data = asRecord(asRecord(await response.json()).data)
    const key = asString(data.qrcode_key)
    const url = asString(data.url)
    if (!key || !url) return { key: '', imageDataUrl: '' }
    const imageDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
    return { key, imageDataUrl }
  } catch (error) {
    fail('qrCreate', error)
    return { key: '', imageDataUrl: '' }
  }
}

type QrStatus = 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'

/**
 * 问一次扫了没有。
 *
 * 上游把状态放在 `data.code` 里：0 成功、86090 已扫待确认、86101 未扫、86038 过期。
 * 真正的凭据在同一次响应的 `Set-Cookie` 里，所以成功这一路必须读响应头。
 */
export async function qrCheck(key: string): Promise<{ status: QrStatus; message?: string }> {
  if (!key) return { status: 'failed', message: '没有二维码' }
  try {
    const response = await fetch(
      'https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=' +
        encodeURIComponent(key),
      {
        headers: { 'User-Agent': USER_AGENT, Referer: REFERER },
        signal: AbortSignal.timeout(12000)
      }
    )
    const data = asRecord(asRecord(await response.json()).data)
    const code = Number(data.code)
    if (code === 0) {
      const setCookies =
        typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
      const kept = setCookies
        .map((line) => line.split(';')[0])
        .filter((pair) => KEEP_COOKIE.test(pair))
      if (kept.length === 0) {
        write('bilibili:qrCheck 登录成功但没有下发凭据')
        return { status: 'failed', message: '登录成功但没拿到凭据，再扫一次试试' }
      }
      writeCookie(activeProfile, kept.join('; '))
      return { status: 'confirmed' }
    }
    if (code === 86090) return { status: 'scanned' }
    if (code === 86038) return { status: 'expired', message: '二维码已过期' }
    return { status: 'waiting' }
  } catch (error) {
    fail('qrCheck', error)
    return { status: 'failed', message: '网络不通，稍后再试' }
  }
}

interface BiliAccount {
  nickname: string
  mid: number
  vip: boolean
  /** 头像地址；拿不到是空串。 */
  face: string
  /** 等级；拿不到是 0。 */
  level: number
}

/** 带着 cookie 问一次自己是谁；未登录回 null。 */
export async function loginStatus(): Promise<BiliAccount | null> {
  const cookie = readCookie(activeProfile)
  if (!cookie) return null
  try {
    const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'User-Agent': USER_AGENT, Referer: REFERER, Cookie: cookie },
      signal: AbortSignal.timeout(12000)
    })
    const data = asRecord(asRecord(await response.json()).data)
    if (data.isLogin !== true) return null
    return {
      nickname: asString(data.uname) || 'B 站用户',
      mid: Number(data.mid) || 0,
      vip: Number(data.vipStatus) === 1,
      face: asString(data.face),
      level: Number(asRecord(data.level_info).current_level) || 0
    }
  } catch (error) {
    fail('loginStatus', error)
    return null
  }
}

export function logout(): void {
  clearCookie(activeProfile)
}
