import { useEffect, useRef, useState } from 'react'
import { Search } from './icons'
import { readSearchHistory, rememberSearch } from '../features/library/search-history'

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
  const [recent, setRecent] = useState<string[]>(() => readSearchHistory())
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
      <div className="shelf-search__box">
        <Search size={14} />
        <input
          ref={input}
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // 敲回车才算「这次搜索用过了」——逐字记录会把历史冲成半截词。
            if (event.key === 'Enter' && value.trim()) setRecent(rememberSearch(value))
          }}
        />
        {value ? (
          <button type="button" className="shelf-search__clear" aria-label="清空" onClick={() => onChange('')}>
            ×
          </button>
        ) : null}
      </div>
      {!value && recent.length > 0 ? (
        <div className="shelf-search__recent">
          {recent.map((word) => (
            <button key={word} type="button" className="shelf-search__word" onClick={() => onChange(word)}>
              {word}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/*
 * 匹配规则的实现在 `features/library/playlist-filter.ts`：它是纯函数，歌单筛选也在用，
 * 且 `node --test` 只进得去不碰 JSX 的文件。这里转出去，调用方照旧写 `from '../ui/ShelfSearch'`。
 */
export { shelfMatches } from '../features/library/playlist-filter'
