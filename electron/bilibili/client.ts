import type { BilibiliQuality, BilibiliSearchResult, BilibiliStreamResult, BilibiliVideo } from './types'
import { accountCookie } from './login'

/**
 * B 站：搜索视频，取它 DASH 里的音频轨道。
 *
 * 这里没有账号体系，也没有歌词：B 站不是音乐平台，视频就是它的「歌」。所以
 * 一条结果 = 一个视频，播放地址来自 `playurl` 的 `dash.audio`，封面来自
 * `view`，标题里的 `<em>` 是搜索高亮，要洗掉。
 *
 * 两个硬约束：
 *   1. 搜索接口要 WBI 签名（`w_rid` + `wts`），不签会被拒；
 *   2. 音频 URL 绑定 UA 与 Referer，缺了 403——所以播放必须走主进程的
 *      `aurora-remote://` 代理，那里会带上这两个头。
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const REFERER = 'https://www.bilibili.com/'

/** WBI 的字符重排表，公开算法，用来把 img_key + sub_key 折成 32 位密钥。 */
const MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
  14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54,
  21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
]

/** 密钥两小时一换就够了；被拒时签名会失效，下一次请求会重新拿。 */
const WBI_TTL_MS = 2 * 60 * 60 * 1000

let wbi: { key: string; at: number } | null = null

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 访客指纹。
 *
 * B 站对没有 buvid 的请求会回 `{code: 0, data: {v_voucher}}`——那是人机验证凭证，
 * 不是搜索结果，看上去和「一条都没搜到」一模一样。指纹从 spi 接口拿，两个值拼成
 * 一次性的 Cookie 头，进程内复用。
 */
let cookieHeader = ''

async function ensureFingerprint(): Promise<void> {
  if (cookieHeader) return
  try {
    /*
     * 先访问一次首页：真实浏览器就是在这里拿到 buvid3/buvid4/b_nut 的，
     * 它们才是搜索接口认的访客身份。spi 接口只给 b_3/b_4，拿不到 home 那次
     * 下发的 b_nut，风控仍会回 voucher，所以两条都试，先取首页那几个。
     */
    const home = await fetch('https://www.bilibili.com/', {
      headers: { 'User-Agent': USER_AGENT, Referer: REFERER },
      signal: AbortSignal.timeout(12000)
    })
    const setCookies = typeof home.headers.getSetCookie === 'function' ? home.headers.getSetCookie() : []
    const kept = setCookies
      .map((line) => line.split(';')[0])
      .filter((pair) => /^(buvid3|buvid4|b_nut|b_lsid|_uuid)=/.test(pair))
    if (kept.length > 0) {
      cookieHeader = kept.join('; ')
      return
    }
    const response = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': USER_AGENT, Referer: REFERER },
      signal: AbortSignal.timeout(10000)
    })
    const data = asRecord(asRecord(await response.json()).data)
    const b3 = asString(data.b_3)
    const b4 = asString(data.b_4)
    if (b3) cookieHeader = 'buvid3=' + b3 + (b4 ? '; buvid4=' + b4 : '')
  } catch {
    // 拿不到就照常发：真被风控时上游会再回 voucher，界面显示为空而不是崩掉。
  }
}

/**
 * 一次请求要带的 Cookie：游客指纹加账号 cookie。
 *
 * 两个都要：指纹决定「像不像一个浏览器」，账号决定「是谁」。只带账号不带指纹时
 * 搜索照样会被风控拦，只带指纹则登录态白搭。
 */
function requestCookie(): string {
  const account = accountCookie()
  return [cookieHeader, account].filter(Boolean).join('; ')
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Referer: REFERER }
  const cookie = requestCookie()
  if (cookie) headers.Cookie = cookie
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  return asRecord(await response.json())
}

/** 百分比编码要按 B 站那版：encodeURIComponent 之外再转 `!'()*`。 */
function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    '%' + char.charCodeAt(0).toString(16).toUpperCase()
  )
}

async function wbiKey(): Promise<string> {
  if (wbi && Date.now() - wbi.at < WBI_TTL_MS) return wbi.key
  const nav = await getJson('https://api.bilibili.com/x/web-interface/nav')
  const img = asRecord(asRecord(nav.data).wbi_img)
  const imgKey = asString(img.img_url).split('/').pop()?.split('.')[0] ?? ''
  const subKey = asString(img.sub_url).split('/').pop()?.split('.')[0] ?? ''
  const raw = imgKey + subKey
  if (raw.length < 64) return ''
  const key = MIXIN_KEY_TABLE.map((index) => raw[index] ?? '').join('').slice(0, 32)
  wbi = { key, at: Date.now() }
  return key
}

/** 给 wbi 接口加签名；拿不到密钥就原样返回，让上游把拒绝说清楚。 */
async function signed(path: string, params: Record<string, string | number>): Promise<string> {
  const key = await wbiKey()
  const all: Record<string, string | number> = { ...params, wts: Math.floor(Date.now() / 1000) }
  const query = Object.keys(all)
    .sort()
    .map((name) => encode(name) + '=' + encode(String(all[name])))
    .join('&')
  const signature = key ? md5(query + key) : ''
  return 'https://api.bilibili.com' + path + '?' + query + (signature ? '&w_rid=' + signature : '')
}

import { createHash } from 'node:crypto'

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

/** 标题里的 `<em class="keyword">` 是搜索高亮，不是内容。 */
function plainTitle(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim()
}

/** 封面走 https，且去掉 upos 的尺寸后缀，交给 aurora-remote 现缩。 */
function coverUrl(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  return text.replace(/^http:\/\//, 'https://').replace(/@[^/]+$/, '')
}

/**
 * 一个视频，取它第一 P。
 *
 * 分 P 的音频其实各自独立（`pages[].cid`），但一首歌就是一个 P，取第一个是
 * 用户在搜索结果里点开时期望的那一段。
 */
async function bilibiliVideo(aid: number): Promise<BilibiliVideo | null> {
  if (!Number.isSafeInteger(aid) || aid <= 0) return null
  await ensureFingerprint()
  const body = await getJson('https://api.bilibili.com/x/web-interface/view?aid=' + aid)
  if (asNumber(body.code) !== 0) return null
  const data = asRecord(body.data)
  const first = asRecord(asArray(data.pages)[0])
  const owner = asRecord(data.owner)
  return {
    aid,
    bvid: asString(data.bvid),
    title: plainTitle(asString(data.title)),
    author: asString(owner.name),
    cover: coverUrl(asString(data.pic)),
    duration: Math.round(asNumber(data.duration)),
    cid: asNumber(first.cid)
  }
}

export async function bilibiliSearch(keywords: string, limit: number): Promise<BilibiliSearchResult> {
  const word = keywords.trim()
  if (!word) return { videos: [] }
  const size = Math.min(Math.max(limit, 1), 50)
  const url = await signed('/x/web-interface/wbi/search/type', {
    search_type: 'video',
    keyword: word,
    page: 1,
    page_size: size
  })
  await ensureFingerprint()
  const body = await getJson(url)
  if (asNumber(body.code) !== 0) {
    // 风控（-352/-412）与「参数不对」都从这里看出来；静默返回空会让界面像没搜到。
    console.error('[aurora] bilibili search refused', asNumber(body.code), asString(body.message))
    return { videos: [] }
  }
  const rows = asArray(asRecord(body.data).result)
  const videos: BilibiliVideo[] = []
  for (const row of rows) {
    const item = asRecord(row)
    const aid = asNumber(item.aid)
    const bvid = asString(item.bvid)
    if (!aid || !bvid) continue
    videos.push({
      aid,
      bvid,
      title: plainTitle(asString(item.title)),
      author: asString(item.author),
      cover: coverUrl(asString(item.pic)),
      // 搜索结果的时长是 "4:30"，换成秒；拿不到就 0，反正播放时会再读一次 view。
      duration: durationOf(asString(item.duration)),
      cid: 0
    })
  }
  return { videos }
}

function durationOf(value: string): number {
  const parts = value.split(':').map((part) => Number(part))
  if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1]
  if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}

/** 共享档位到 B 站音频 id 的候选，从高到低试。 */
const TIER_AUDIO_IDS: Record<BilibiliQuality, number[]> = {
  standard: [30216],
  higher: [30232],
  exhigh: [30280],
  lossless: [30251, 30250, 30280],
  hires: [30251, 30250, 30280]
}

/** 音频 id 回读成共享档位，界面显示的是「真拿到了什么」。 */
function tierOfAudioId(id: number): BilibiliQuality {
  if (id === 30251) return 'hires'
  if (id === 30250) return 'lossless'
  if (id === 30280) return 'exhigh'
  if (id === 30232) return 'higher'
  return 'standard'
}

export async function bilibiliStreamUrl(
  aid: number,
  quality: BilibiliQuality
): Promise<BilibiliStreamResult> {
  const video = await bilibiliVideo(aid)
  if (!video) return { ok: false, reason: 'unknown', message: '这个视频不存在' }
  if (!video.cid) return { ok: false, reason: 'unavailable', message: '这个视频没有可播放的分段' }
  const url =
    'https://api.bilibili.com/x/player/playurl?bvid=' +
    encodeURIComponent(video.bvid) +
    '&cid=' +
    video.cid +
    '&fnval=16&fourk=1'
  const body = await getJson(url)
  if (asNumber(body.code) !== 0) {
    return { ok: false, reason: 'unavailable', message: asString(body.message) || 'B 站没有给播放地址' }
  }
  const dash = asRecord(asRecord(body.data).dash)
  const tracks = asArray(dash.audio).map((row) => {
    const item = asRecord(row)
    return {
      id: asNumber(item.id),
      url: asString(item.baseUrl) || asString(item.base_url),
      bandwidth: asNumber(item.bandwidth)
    }
  })
  if (tracks.length === 0) return { ok: false, reason: 'unavailable', message: '这个视频没有音频轨' }
  const wanted = TIER_AUDIO_IDS[quality] ?? TIER_AUDIO_IDS.exhigh
  let picked = tracks.find((track) => wanted.includes(track.id))
  if (!picked) {
    // 请求的那一档没有，就取它能给的最高一档，界面显示的是回包里的档位。
    picked = [...tracks].sort((a, b) => b.bandwidth - a.bandwidth)[0]
  }
  return {
    ok: true,
    stream: {
      url: picked.url,
      br: Math.round(picked.bandwidth / 1000),
      level: tierOfAudioId(picked.id),
      duration: video.duration,
      trial: false
    }
  }
}
