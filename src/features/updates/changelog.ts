/**
 * CHANGELOG.md 里「这一版改了什么」的解析。
 *
 * 更新公告要在装完之后弹一次，内容就取项目根目录的 CHANGELOG.md——它本来就
 * 是发布说明的来源，不再多维护一份「应用内公告」。文件整份打进包里（约
 * 30 KB），这里只挑出当前版本那一节。
 *
 * 解析写得很窄：只认 `## 1.2.3` 的版本标题、`### 分组` 与小节里的 `- 条目`。
 * 这份文件是我们自己写的，不需要通用 Markdown；认不出来的行直接忽略，坏一行
 * 不会让整段消失。
 */

interface ChangelogSection {
  /** `### 壁纸` 这类分组名。 */
  title: string
  /** 分组下的条目，已去掉行内标记。 */
  items: string[]
}

export interface ChangelogEntry {
  version: string
  sections: ChangelogSection[]
}

const VERSION_HEAD = /^##\s+v?(\d+\.\d+\.\d+)\b/
const SECTION_HEAD = /^###\s+(.+?)\s*$/
const ITEM = /^\s*-\s+(.*)$/

/** 去掉 `**粗体**`、`` `代码` `` 与首尾多余空白，只留能直接显示的文字。 */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 取最新一版的条目；`wanted` 给了就只在版本一致时返回。
 *
 * 一致才返回是有意的：CHANGELOG 忘了写新版本时，弹出来的是上一版的改动，
 * 比不弹更糟。那时返回 null，界面就不显示公告。
 */
export function parseChangelog(raw: string, wanted?: string): ChangelogEntry | null {
  const lines = raw.split(/\r?\n/)
  let version: string | null = null
  let collecting = false
  const sections: ChangelogSection[] = []
  let current: ChangelogSection | null = null

  for (const line of lines) {
    const head = VERSION_HEAD.exec(line)
    if (head) {
      /* 第一个版本标题就是最新一版；再遇到下一个标题说明这一节结束了。 */
      if (collecting) break
      if (wanted && head[1] !== wanted) return null
      version = head[1]
      collecting = true
      continue
    }
    if (!collecting) continue

    /* 未发布段（`## 未发布`）不算版本，会在进入 collecting 之前就跳过。 */
    const section = SECTION_HEAD.exec(line)
    if (section) {
      current = { title: plain(section[1]), items: [] }
      sections.push(current)
      continue
    }

    const item = ITEM.exec(line)
    if (!item || !current) continue
    const text = plain(item[1])
    if (text) current.items.push(text)
  }

  if (!version) return null
  const kept = sections.filter((section) => section.items.length > 0)
  if (kept.length === 0) return null
  return { version, sections: kept }
}
