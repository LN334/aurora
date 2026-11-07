import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { KugouQuality } from './types'

/**
 * 一个档案的酷狗登录态与音质偏好，用 `safeStorage` 加密后存在 userData。
 *
 * 形状与 `electron/qq/session.ts` 一致，理由也一样：Cookie/token 是凭据，不能
 * 明文躺在盘上；而 `safeStorage` 在没有 keyring 的机器上不可用，那种情况下
 * 内存兜底 + 一次 console.error，而不是让登录直接崩掉。
 *
 * 只存四样：token、userid、昵称头像（免得每次启动先打一次账号接口）、音质。
 * 不存 cookie 全文——酷狗这边用自己的 `Cookie: token=..; userid=..`，没有
 * 第三方 SDK 的 jar 需要照顾。
 */

export interface KugouProfileState {
  token: string
  userid: string
  nickname: string
  avatarUrl: string | null
  quality: KugouQuality
}

const DEFAULT_QUALITY: KugouQuality = 'exhigh'

const EMPTY: KugouProfileState = {
  token: '',
  userid: '',
  nickname: '',
  avatarUrl: null,
  quality: DEFAULT_QUALITY
}

/** 没有 keyring 时的兜底：至少这次运行内登录态是活的。 */
const memory = new Map<string, KugouProfileState>()
let warned = false

/** 档案 id 会进文件名，所以只接受安全字符，其余归到 `default`。 */
function safeProfileId(profileId: string): string {
  const trimmed = String(profileId ?? '').trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : 'default'
}

const stateFile = (profileId: string): string =>
  path.join(app.getPath('userData'), `kugou-session.${safeProfileId(profileId)}.bin`)

/** 逐字段校验：解密出来的东西可能来自旧版本，缺字段就用默认值补。 */
function revive(value: unknown): KugouProfileState {
  if (!value || typeof value !== 'object') return { ...EMPTY }
  const raw = value as Record<string, unknown>
  const quality = raw.quality
  return {
    token: typeof raw.token === 'string' ? raw.token : '',
    userid: typeof raw.userid === 'string' ? raw.userid : '',
    nickname: typeof raw.nickname === 'string' ? raw.nickname : '',
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    quality:
      quality === 'standard' || quality === 'higher' || quality === 'exhigh' || quality === 'lossless'
        ? quality
        : DEFAULT_QUALITY
  }
}

export function readState(profileId: string): KugouProfileState {
  const key = safeProfileId(profileId)
  const cached = memory.get(key)
  if (cached) return cached

  if (!safeStorage.isEncryptionAvailable()) return { ...EMPTY }

  try {
    const file = stateFile(key)
    if (!fs.existsSync(file)) return { ...EMPTY }
    const decrypted = safeStorage.decryptString(fs.readFileSync(file))
    const state = revive(JSON.parse(decrypted))
    memory.set(key, state)
    return state
  } catch {
    // 解不开就是「未登录」：比抛错好，第一次启动本来就没有文件。
    return { ...EMPTY }
  }
}

export function writeState(profileId: string, patch: Partial<KugouProfileState>): KugouProfileState {
  const key = safeProfileId(profileId)
  const next = { ...readState(key), ...patch }
  memory.set(key, next)

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      if (!warned) {
        warned = true
        console.error('[aurora] 这台机器上没有可用的密钥环，酷狗登录态只会存在内存里')
      }
      return next
    }
    const file = stateFile(key)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(next)))
  } catch (error) {
    console.error(
      '[aurora] 写酷狗登录态失败',
      error instanceof Error ? error.message : String(error)
    )
  }
  return next
}

/** 只清登录态，保留音质偏好：退出登录不该顺手改掉用户的音质选择。 */
export function clearSession(profileId: string): KugouProfileState {
  const key = safeProfileId(profileId)
  const previous = readState(key)
  memory.set(key, { ...previous, token: '', userid: '', nickname: '', avatarUrl: null })
  try {
    const file = stateFile(key)
    if (fs.existsSync(file)) fs.rmSync(file)
  } catch (error) {
    console.error(
      '[aurora] 清酷狗登录态失败',
      error instanceof Error ? error.message : String(error)
    )
  }
  return readState(key)
}

export function hasSession(profileId: string): boolean {
  return readState(profileId).token.length > 0
}
