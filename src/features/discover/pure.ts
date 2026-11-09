import type { NeteaseDiscoverPlaylist, NeteaseSong } from '../../env'

/**
 * 「发现」页的纯逻辑：标签、计数文案、归一化与空态判断。
 *
 * 这里刻意不 import React：这些规则是本页唯一能被 `node --test` 直接验证的
 * 部分（页面本身要真窗口才能看），所以「去重、丢弃无效 id、何时算空」都放在
 * 函数里，而不是散在 JSX 的条件表达式里。
 */

/** 发现页的栏目。顺序就是第二排标签的顺序。 */
export type DiscoverKind = 'newsongs' | 'playlists' | 'quality'

interface DiscoverTab {
  id: DiscoverKind
  label: string
}

/** 网易云公开接口对应的三栏；名字对齐接口内容，不是空泛的分类。 */
export const DISCOVER_TABS: readonly DiscoverTab[] = [
  { id: 'newsongs', label: '推荐歌曲' },
  { id: 'playlists', label: '推荐歌单' },
  { id: 'quality', label: '分类歌单' }
]

export function isDiscoverKind(value: string): value is DiscoverKind {
  return DISCOVER_TABS.some((tab) => tab.id === value)
}

export function tabLabel(kind: DiscoverKind): string {
  return DISCOVER_TABS.find((tab) => tab.id === kind)?.label ?? '推荐歌曲'
}

/** 播放量/曲目数用同一个紧凑写法：12.3万、1.2亿。 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value < 10_000) return String(Math.trunc(value))
  if (value < 100_000_000) return `${oneDecimal(value / 10_000)}万`
  return `${oneDecimal(value / 100_000_000)}亿`
}

function oneDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '')
}

/** 卡片第二行：创建者优先，推荐语兜底；都没有就不占位。 */
export function playlistSubtitle(
  playlist: Pick<NeteaseDiscoverPlaylist, 'creator' | 'note'>
): string | undefined {
  const creator = playlist.creator.trim()
  if (creator) return creator
  const note = playlist.note.trim()
  return note || undefined
}

/** 卡片右端：曲目数 · 播放量。缺哪一端就少哪一段，两段都缺时给个中性词。 */
export function playlistMeta(
  playlist: Pick<NeteaseDiscoverPlaylist, 'trackCount' | 'playCount'>
): string {
  const parts: string[] = []
  if (Number.isFinite(playlist.trackCount) && playlist.trackCount > 0) {
    parts.push(`${Math.trunc(playlist.trackCount)} 首`)
  }
  const plays = formatCount(playlist.playCount)
  if (plays) parts.push(`${plays} 播放`)
  return parts.join(' · ') || '歌单'
}

/**
 * 丢掉不能渲染的卡片，并按 id 去重。
 *
 * 上游的「推荐」里会出现重复 id（同一歌单被两个推荐位选中），React 的 key 撞车
 * 会让卡片重影；id 不是正整数的行点了也只会得到一次 404。
 */
export function normalizePlaylists(
  rows: readonly NeteaseDiscoverPlaylist[]
): NeteaseDiscoverPlaylist[] {
  const seen = new Set<number>()
  const out: NeteaseDiscoverPlaylist[] = []
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) continue
    seen.add(row.id)
    out.push({
      ...row,
      name: row.name.trim() || '未命名歌单',
      creator: row.creator.trim(),
      note: row.note.trim()
    })
  }
  return out
}

/** 同样的规则用在歌曲行：去重、丢无效 id，保留顺序。 */
export function normalizeSongs(rows: readonly NeteaseSong[]): NeteaseSong[] {
  const seen = new Set<number>()
  const out: NeteaseSong[] = []
  for (const row of rows) {
    if (!row || !Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

/** 当前栏目是否已有可显示的内容（决定显示列表还是空态）。 */
export function hasContent(
  kind: DiscoverKind,
  block: { songs: readonly unknown[]; playlists: readonly unknown[] }
): boolean {
  return kind === 'newsongs' ? block.songs.length > 0 : block.playlists.length > 0
}

/**
 * 内容为空、又没有报错时的那句话。
 *
 * 分开写而不是一句「暂无内容」：这三种空各有原因，用户看到的下一句应该不同。
 */
export function emptyTextFor(kind: DiscoverKind, platformName: string): string {
  if (kind === 'newsongs') {
    return `${platformName} 这会儿没有返回新歌，稍后再试试。`
  }
  if (kind === 'quality') {
    return `${platformName} 这会儿没有返回分类歌单，稍后再试试。`
  }
  return `${platformName} 这会儿没有返回推荐歌单，稍后再试试。`
}

/** 新歌行的副标题：歌手名，空歌手时交给行组件显示「未知」。 */
export function songArtistsText(song: Pick<NeteaseSong, 'artists'>): string {
  return song.artists.map((artist) => artist.name).filter(Boolean).join(' / ')
}
