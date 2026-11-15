import { Search } from './icons'

/**
 * 书架上的搜索框。
 *
 * 「收藏专辑」与「关注艺人」都是几百条的平铺墙，一次只看得见前二十个——没有
 * 搜索就只能靠滚动找。这里只做本地过滤：数据已经在手里，不该为一次筛选再问
 * 平台一遍。
 *
 * 抽成组件而不是各写一份，是因为这两页的头本来就一样（标题 + 计数 + 一排卡片），
 * 搜索框再各写一遍，下次调整样式就要改两处。
 */
export function ShelfSearch({
  value,
  placeholder,
  onChange
}: {
  value: string
  placeholder: string
  onChange(next: string): void
}) {
  return (
    <div className="shelf-search">
      <Search size={14} />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="shelf-search__clear" aria-label="清空" onClick={() => onChange('')}>
          ×
        </button>
      ) : null}
    </div>
  )
}

/**
 * 这一行是否匹配查询。
 *
 * 按词拆开、全部命中才算：搜「陈 奕迅」能同时找到名字里带「陈」与「奕迅」的那一条，
 * 而搜「陈奕迅 演唱会」不会因为中间有空格就全落空。大小写不敏感——中文用不上，
 * 但专辑名里常夹英文。
 */
export function shelfMatches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fields.filter(Boolean).join(' ').toLowerCase()
  return words.every((word) => haystack.includes(word))
}
