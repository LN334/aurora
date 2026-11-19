/**
 * 与 `features/player/store.ts` 的 EQ_BANDS 同源：十条 band。
 *
 * 不 import 那个常量，是因为 store 带着 zustand 与持久化，纯函数模块一旦依赖
 * 它就跑不进 node --test（这是个只有编解码、该被单测覆盖的模块）。
 */
const BAND_COUNT = 10

/**
 * 声音预设的分享码。
 *
 * 学 Muonium 的 `ShareCode`：把一套设置压成一个短串，复制给别人、粘进输入框
 * 就还原。这里只装「声音」部分——EQ 十二条曲线（开关 + 十个增益）与交叉淡化，
 * 外观（主题、歌词样式）不进来：Aurora 的配色本来就由封面主色驱动，没有一套
 * 可分享的主题可存。
 *
 * 编码是 base64url 而不是 base62：长度差几个字符，但用标准实现就不必自己写
 * 进位除法，也不会因为字母表顺序和别人对不上而解错。前缀 `A1` 是版本号，
 * 以后加字段时旧码仍然能被认出来并拒绝，而不是解出半套设置。
 */

interface SoundPreset {
  name: string
  eqEnabled: boolean
  /** 十个增益，顺序同 EQ_BANDS。 */
  gains: number[]
  crossfadeSec: number
}

const VERSION = 'A1'
const MAX_CODE = 2048

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** 一条曲线是否可信：长度对、每个值都是 -12..12 的整数。 */
function validGains(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== BAND_COUNT) return false
  return value.every((item) => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 12)
}

export function encodePreset(preset: SoundPreset): string {
  const payload = {
    n: preset.name.trim().slice(0, 16) || '我的预设',
    e: preset.eqEnabled ? 1 : 0,
    g: preset.gains.map((gain) => Math.round(gain)),
    c: Math.round(preset.crossfadeSec * 10) / 10
  }
  return VERSION + toBase64Url(JSON.stringify(payload))
}

/**
 * 解码失败一律返回 null。
 *
 * 不抛错：这个串会从剪贴板里来，粘错一个字符是常态，界面该说「这串不认识」，
 * 而不是让整个面板崩掉。
 */
export function decodePreset(code: string): SoundPreset | null {
  const text = code.trim()
  if (!text.startsWith(VERSION) || text.length > MAX_CODE) return null
  let payload: unknown
  try {
    payload = JSON.parse(fromBase64Url(text.slice(VERSION.length)))
  } catch {
    return null
  }
  const record = payload as Record<string, unknown>
  if (!record || typeof record !== 'object') return null
  if (!validGains(record.g)) return null
  const crossfade = typeof record.c === 'number' && Number.isFinite(record.c) ? record.c : 0
  return {
    name: typeof record.n === 'string' && record.n.trim() ? record.n.trim() : '分享的预设',
    eqEnabled: record.e === 1,
    gains: record.g,
    crossfadeSec: Math.min(12, Math.max(0, crossfade))
  }
}