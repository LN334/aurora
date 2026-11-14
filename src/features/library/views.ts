import type { Track } from '../../types'
import type { PlayEntry } from '../player/history'

/*
 * 本机库与歌单的排序规则，抽成纯函数。
 *
 * 这里只决定「顺序」，不碰数据与存储：页面拿到排好的数组照常渲染，歌单把排好的
 * id 写回 store。这样做的好处在测试——排序是典型的「看起来对、边界一碰就错」的
 * 逻辑（同名、无标题、缺字段、并列），用用例把边界钉住比靠界面目测可靠得多。
 */

/** 本机歌曲页的顺序。`default` 是扫描结果自己的顺序，不做任何重排。 */
export type SongOrder = 'default' | 'recent' | 'plays'

/**
 * 歌单内的顺序。`manual` 表示用户拖出来的顺序，也就是存下来的那份。
 * 其余四种按字段排，排完会把结果写回歌单。
 */
export type PlaylistOrder = 'manual' | 'added' | 'title' | 'artist' | 'duration'

/*
 * 中文标题按拼音排，数字按数值（「歌 2」在「歌 10」前面）。sensitivity 'base'
 * 让大小写与全半角差异不参与比较——否则「ABC」与「abc」会被当成两组。
 */
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })

const untitled = (track: Track) => track.title || '（无标题）'

const byTitle = (a: Track, b: Track) => collator.compare(untitled(a), untitled(b))

const byArtist = (a: Track, b: Track) => collator.compare(a.artist, b.artist)

/** 每首歌被播放的次数，按曲目 id 聚合。 */
export function playCounts(plays: PlayEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const play of plays) {
    // 解析旧存档时可能留下没有曲目快照的行，那种行不参与计数。
    const id = play.track?.id
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

export function orderTracks(tracks: Track[], order: SongOrder, counts: Map<string, number>): Track[] {
  if (order === 'default') return tracks
  if (order === 'recent') {
    // 同一秒内加入的文件（一次扫描常见）用标题兜底，保证每次打开顺序一致。
    return [...tracks].sort((a, b) => b.addedAt - a.addedAt || byTitle(a, b))
  }
  // 没播过的歌次数相同，于是自然沉到后面，并且内部仍按「最近添加」排列。
  return [...tracks].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || b.addedAt - a.addedAt || byTitle(a, b)
  )
}

export function orderPlaylistTracks(tracks: Track[], order: PlaylistOrder): Track[] {
  if (order === 'manual') return tracks
  // 歌单条目没有自己的「加入时间」，用曲目入库时间近似——对本地文件足够，
  // 对在线曲目则退化为「抓到它的时间」。
  if (order === 'added') return [...tracks].sort((a, b) => b.addedAt - a.addedAt || byTitle(a, b))
  if (order === 'title') return [...tracks].sort(byTitle)
  if (order === 'artist') {
    // 同一艺人的歌按专辑、碟号、轨号排，正是专辑里的自然顺序。
    return [...tracks].sort(
      (a, b) =>
        byArtist(a, b) ||
        collator.compare(a.album, b.album) ||
        (a.discNo ?? 0) - (b.discNo ?? 0) ||
        (a.trackNo ?? 0) - (b.trackNo ?? 0) ||
        byTitle(a, b)
    )
  }
  return [...tracks].sort((a, b) => a.duration - b.duration || byTitle(a, b))
}
