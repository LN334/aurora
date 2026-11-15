import { useEffect, useRef } from 'react'
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
  const input = useRef<HTMLInputElement>(null)
  /*
   * 回调每次渲染都是新的，但监听只该挂一次 —— 所以把它放进 ref，
   * 免得每敲一个字就把 window 上的 keydown 拆了重装。
   */
  const handler = useRef(onChange)
  handler.current = onChange

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        // 列表在手边却要滚着找，是最常见的抱怨；Ctrl+F 直接落进这个框。
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
        return
      }
      if (event.key === 'Escape' && document.activeElement === input.current) {
        /*
         * 空着就把 Esc 让出去：这时它表达的是「关掉这层」，不是「清空搜索」。
         * 有内容才接住，并且不让它继续传 —— 否则同一颗 Esc 会顺手把页面也退掉。
         */
        const field = input.current
        if (!field || field.value === '') return
        event.preventDefault()
        // 捕获阶段先接住：全局快捷键也在 window 上，但它注册得更早，冒泡时轮到它就已经把页面退了一层。
        event.stopPropagation()
        handler.current('')
        field.blur()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="shelf-search">
      <Search size={14} />
      <input
        ref={input}
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
