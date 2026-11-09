import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import { createQishuiDeviceId, isQishuiDeviceId } from 'qishui-music-api'

/**
 * 一个档案的汽水登录态，用 `safeStorage` 加密后存在 userData。
 *
 * 与另外两个平台同一套做法，但这里多存一样东西：`deviceId`。
 * 汽水（抖音）把设备 id 当成身份的一部分——它由 `createQishuiDeviceId()` 生成
 * 一次、之后必须复用；换一个 id 等于换一台设备，已授权的会话不再被承认。
 * 所以它随会话一起落盘，而不是每次启动重新生成。
 *
 * `session` 是 SDK 自己维护的授权对象，形状由它定义，这里只当作不透明数据
 * 原样加解密：读它的字段就是把 SDK 的内部结构钉死在这里，升级就断。
 */

interface QishuiProfileState {
  deviceId: string
  session: unknown
}

const memory = new Map<string, QishuiProfileState>()
let warned = false

/** 档案 id 会进文件名，所以只接受安全字符。 */
function safeProfileId(profileId: string): string {
  const trimmed = String(profileId ?? '').trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : 'default'
}

const stateFile = (profileId: string): string =>
  path.join(app.getPath('userData'), `qishui-session.${safeProfileId(profileId)}.bin`)

function fresh(): QishuiProfileState {
  return { deviceId: createQishuiDeviceId(), session: null }
}

function revive(value: unknown): QishuiProfileState {
  if (!value || typeof value !== 'object') return fresh()
  const raw = value as Record<string, unknown>
  return {
    // 校验而不是相信：一个被手改坏的文件不该让平台永久不可用。
    deviceId: isQishuiDeviceId(raw.deviceId) ? raw.deviceId : createQishuiDeviceId(),
    session: raw.session ?? null
  }
}

export function readState(profileId: string): QishuiProfileState {
  const key = safeProfileId(profileId)
  const cached = memory.get(key)
  if (cached) return cached

  // 新生成的 deviceId 也要立刻进内存缓存：两次调用若各生成一个，
  // 包初始化时 deviceId 与 sessions.deviceId 就对不上，直接抛错。
  const adopt = (state: QishuiProfileState): QishuiProfileState => {
    memory.set(key, state)
    return state
  }

  if (!safeStorage.isEncryptionAvailable()) return adopt(fresh())

  try {
    const file = stateFile(key)
    if (!fs.existsSync(file)) return adopt(fresh())
    const decrypted = safeStorage.decryptString(fs.readFileSync(file))
    const state = revive(JSON.parse(decrypted))
    memory.set(key, state)
    return state
  } catch {
    return adopt(fresh())
  }
}

export function writeState(profileId: string, patch: Partial<QishuiProfileState>): QishuiProfileState {
  const key = safeProfileId(profileId)
  const next = { ...readState(key), ...patch }
  memory.set(key, next)

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      if (!warned) {
        warned = true
        console.error('[aurora] 这台机器上没有可用的密钥环，汽水登录态只会存在内存里')
      }
      return next
    }
    const file = stateFile(key)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(next)))
  } catch (error) {
    console.error('[aurora] 写汽水登录态失败', error instanceof Error ? error.message : String(error))
  }
  return next
}

export function clearSession(profileId: string): QishuiProfileState {
  const key = safeProfileId(profileId)
  const previous = readState(key)
  const next = { ...previous, session: null }
  memory.set(key, next)
  try {
    const file = stateFile(key)
    if (fs.existsSync(file)) fs.rmSync(file)
  } catch (error) {
    console.error('[aurora] 清汽水登录态失败', error instanceof Error ? error.message : String(error))
  }
  return next
}
