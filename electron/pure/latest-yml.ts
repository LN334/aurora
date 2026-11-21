/**
 * 解析 electron-builder 生成的 latest.yml。
 *
 * 为什么自己解析：下载安装包前必须先知道 sha512 和大小，而 electron-updater
 * 要拿这份清单，走的是 `github.com/.../releases/download/...` 这条地址——它
 * 会 302 到 release-assets.githubusercontent.com，那个域名在不少网络里直接
 * 不通。清单本身只有几百字节，换一条线路就能取到，所以取清单这件事不能让
 * electron-updater 独占。
 *
 * 格式由 electron-builder 固定生成，不做通用 YAML 解析：
 *
 * ```
 * version: 1.0.0
 * files:
 *   - url: Aurora-1.0.0-Setup.exe
 *     sha512: ...
 *     size: 123456
 * path: Aurora-1.0.0-Setup.exe
 * sha512: ...
 * ```
 */

export interface LatestFile {
  /** 清单里的文件名，可能带编码。 */
  url: string
  /** base64 的 sha512。 */
  sha512: string
  /** 字节数；清单没写就是 0。 */
  size: number
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed[0] === trimmed[trimmed.length - 1]) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * 取第一个文件的 url / sha512 / size。
 *
 * 顶层那几个同名字段是给单文件发布用的，`files` 缺席时才回退到它们。
 */
export function parseLatestYml(text: string): LatestFile | null {
  const entries: LatestFile[] = []
  let current: LatestFile | null = null
  let inFiles = false
  let topUrl = ''
  let topSha = ''
  let topSize = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    if (/^files:\s*$/.test(line)) {
      inFiles = true
      continue
    }
    // 缩进决定层级：files 块里的字段都是缩进的，回到顶格就是块结束了。
    // 不能靠「像不像键名」判，块内的 sha512 / size 同样长着键名的样子。
    if (inFiles && !/^\s/.test(raw)) inFiles = false

    if (inFiles) {
      const start = /^-\s*url:\s*(.+)$/.exec(line)
      if (start) {
        current = { url: unquote(start[1]), sha512: '', size: 0 }
        entries.push(current)
        continue
      }
      if (!current) continue
      const sha = /^sha512:\s*(.+)$/.exec(line)
      if (sha) {
        current.sha512 = unquote(sha[1])
        continue
      }
      const size = /^size:\s*(\d+)\s*$/.exec(line)
      if (size) current.size = Number(size[1])
      continue
    }

    const path = /^path:\s*(.+)$/.exec(line)
    if (path) {
      topUrl = unquote(path[1])
      continue
    }
    const sha = /^sha512:\s*(.+)$/.exec(line)
    if (sha) topSha = unquote(sha[1])
  }

  const first = entries.find((entry) => entry.url.length > 0)
  if (first) {
    return { url: first.url, sha512: first.sha512 || topSha, size: first.size || topSize }
  }
  if (topUrl) return { url: topUrl, sha512: topSha, size: topSize }
  return null
}
