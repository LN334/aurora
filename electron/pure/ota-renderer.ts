import path from 'node:path'

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
  return { dir, hash }
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
