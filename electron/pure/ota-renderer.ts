import path from 'node:path'
import { isNewer } from './version.ts'

/**
 * 本机热更的渲染层（OTA）。
 *
 * 改一行界面不必重新打包 100 MB 的安装包：`scripts/ota-push.mjs` 把当前的
 * `dist/` 复制到 `userData/ota/renderers/<指纹>/`，再写一份 state.json 指过去；
 * 主进程启动时优先加载那里，没有就回落到安装包里那份。
 *
 * 只在本机生效，不联网、不校验签名——这个目录本来就归用户，能写它的人也能直接
 * 改安装目录。发布版不提供远程下发；要远程更新仍然走 electron-updater 的差分包。
 *
 * 这里只放能单测的部分：解析与路径闸门。真正的读盘在协议处理器里。
 */

interface OtaRenderer {
  /** 渲染层目录，绝对路径。 */
  dir: string
  /** 产物指纹，写进启动日志方便对账。 */
  hash: string
  /**
   * 打包这份 dist 时的版本号（脚本从 package.json 抄来）。
   *
   * 旧的 state.json 没有这一项——那时热更只有指纹，看不出它是哪一版。空串表示
   * 未记录，不代表错误：解析照常通过，只是「安装包是否已经超过它」无从判断。
   */
  version: string
  /** 写这份 state 的毫秒时间；0 表示未记录。 */
  at: number
}

/**
 * 解析 state.json。
 *
 * 坏 JSON、缺字段、`dir` 不是字符串——一律当作没有热更，回落到安装包。
 * 不抛错：一个写坏的 state 不该让应用起不来。
 */
export function parseOtaState(text: string | null | undefined): OtaRenderer | null {
  if (!text) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const dir = typeof record.dir === 'string' ? record.dir.trim() : ''
  if (!dir) return null
  const hash = typeof record.hash === 'string' ? record.hash : ''
  const version = typeof record.version === 'string' ? record.version.trim() : ''
  const at = typeof record.at === 'number' && Number.isFinite(record.at) ? record.at : 0
  return { dir, hash, version, at }
}

/**
 * 安装包是否已经比这份热更新。
 *
 * 严格大于才算：热更记录的版本通常等于当时的 package.json，而日常「改一行 →
 * build → ota-push → 重启看」并不会 bump 版本——装回同版本时把热更撤掉，正好
 * 把这条最常用的路堵死。只有真装上了更新的安装包，那份 dist 才必然包含这次热更。
 */
export function otaSuperseded(state: OtaRenderer, installVersion: string): boolean {
  if (!state.version) return false
  return isNewer(installVersion, state.version)
}

/**
 * 目录必须落在 renderers 之下。
 *
 * state.json 是一份可被手改的普通文件；不给闸门的话，往里面写一个
 * `C:\\Windows` 就能让协议去服务那个目录。前缀比较要带分隔符，
 * 否则 `.../renderers-evil` 也会通过。
 */
export function otaDirAllowed(dir: string, renderersRoot: string): boolean {
  const normalized = path.resolve(dir)
  const root = path.resolve(renderersRoot)
  return normalized.startsWith(root + path.sep)
}
