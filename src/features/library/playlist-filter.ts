/**
 * 这一行是否匹配查询。
 *
 * 按词拆开、全部命中才算：搜「陈 奕迅」能同时找到名字里带「陈」与「奕迅」的那一条，
 * 而搜「陈奕迅 演唱会」不会因为中间有空格就全落空。大小写不敏感——中文用不上，
 * 但专辑名里常夹英文。
 *
 * 放在这个纯函数文件里，而不是组件文件里：Node 直跑测试时解析不了 `.tsx`，
 * 匹配规则得让 `node --test` 能进得来。`ShelfSearch.tsx` 从这儿转出给界面用。
 */
export function shelfMatches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** 歌单详情页筛出来的一行：`index` 是它在歌单里的原始位置，不是筛后的序号。 */
interface FilteredRow<T> {
  track: T
  index: number
}

/**
 * 按关键词筛歌单。
 *
 * 每一行都带上原始下标：点一行要播的是那一首，拖一行要移的也是那一个位置。
 * 如果界面拿筛后的序号当参数，前面少几行就会整体串位 —— 播错歌、移错位置，
 * 而且两种错都不报错，只是「怎么放的和我以为的不一样」。
 */
export function filterPlaylistRows<T extends { title: string; artist: string; album?: string | null }>(
  tracks: T[],
  query: string
): FilteredRow<T>[] {
  const indexed = tracks.map((track, index) => ({ track, index }))
  if (query.trim() === '') return indexed
  return indexed.filter(({ track }) => shelfMatches(query, track.title, track.artist, track.album ?? ''))
}
