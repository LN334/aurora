import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'

/**
 * 一个档案的 B 站登录态。
 *
 * 只存一样东西：`Cookie` 头里那几个键值（SESSDATA、bili_jct、DedeUserID、sid）。
 * B 站不发刷新令牌，会话就是这串 cookie；过期了就重新扫码。
 *
 * 与另外四家同一套做法：`safeStorage` 加密后落在 userData，文件名带档案 id。
 * 换档案就是换一个人，不该拿着上一个人的 sessdata 去搜。
 */

interface BiliSession {
  /** `k=v; k=v`；空串是未登录。 */
  cookie: string
}

const memory = new Map<string, BiliSession>()

function safeProfileId(profileId: string): string {
  const trimmed = String(profileId ?? '').trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : 'default'
}

const stateFile = (profileId: string): string =>
  path.join(app.getPath('userData'), `bilibili-session.${safeProfileId(profileId)}.bin`)

/** 读一次 cookie；读不出来就是未登录，不抛。 */
export function readCookie(profileId: string): string {
  const key = safeProfileId(profileId)
  const cached = memory.get(key)
  if (cached) return cached.cookie
  if (!safeStorage.isEncryptionAvailable()) return ''
  try {
    const file = stateFile(key)
    if (!fs.existsSync(file)) return ''
    const parsed = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))) as {
      cookie?: unknown
    }
    const cookie = typeof parsed.cookie === 'string' ? parsed.cookie : ''
    if (cookie) memory.set(key, { cookie })
    return cookie
  } catch {
    return ''
  }
}

export function writeCookie(profileId: string, cookie: string): void {
  const key = safeProfileId(profileId)
  memory.set(key, { cookie })
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.error('[aurora] 这台机器上没有可用的密钥环，B 站登录态只会存在内存里')
      return
    }
    const file = stateFile(key)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify({ cookie })))
  } catch (error) {
    console.error('[aurora] 写 B 站登录态失败', error instanceof Error ? error.message : String(error))
  }
}

export function clearCookie(profileId: string): void {
  const key = safeProfileId(profileId)
  memory.delete(key)
  try {
    const file = stateFile(key)
    if (fs.existsSync(file)) fs.rmSync(file)
  } catch (error) {
    console.error('[aurora] 清 B 站登录态失败', error instanceof Error ? error.message : String(error))
  }
}
