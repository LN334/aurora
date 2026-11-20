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
  onChange,
  listenEvent,
  hideTrigger
}: {
  value: string
  placeholder: string
  onChange(next: string): void
  /**
   * 由页面标题栏上那颗「筛选」代劳展开时用：这里只听这个事件，不画自己的放大镜。
   *
   * 收藏页把筛选与刷新放进了页头（页面里单独一行工具条，只有两颗小东西，漂在
   * 列表上方既不像标题也不像内容），所以收起态不再需要一个本地触发按钮。
   */
  listenEvent?: string
  hideTrigger?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [recent, setRecent] = useState<string[]>(() => readSearchHistory())
  /*
   * 默认收起成一颗放大镜。
   *
   * 窗口最顶栏已经有一个全局搜索框（Ctrl K），列表上方再摆一个同样宽的输入框，
   * 读起来像「同一个搜索出现了两次」。收起来之后它只是一颗「筛这份列表」的键，
   * 点开才变成输入框；已经有筛选词时保持展开，不会把用户正在改的字藏掉。
   */
  const [open, setOpen] = useState(value !== '')
  /** 给 window 上的 keydown 读当前是否展开；effect 只挂一次，闭包里的 open 会过期。 */
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (value) setOpen(true)
  }, [value])
  /*
   * 回调每次渲染都是新的，但监听只该挂一次 —— 所以把它放进 ref，
   * 免得每敲一个字就把 window 上的 keydown 拆了重装。
   */
  const handler = useRef(onChange)
  handler.current = onChange

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        /*
         * 列表在手边却要滚着找，是最常见的抱怨；Ctrl+F 直接落进这个框。
         * 收起态下要先把它展开——焦点落不到还没渲染的输入框上。
         */
        event.preventDefault()
        if (!openRef.current) {
          setOpen(true)
          requestAnimationFrame(() => {
            input.current?.focus()
            input.current?.select()
          })
          return
        }
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

  /*
   * 页头那颗「筛选」点下来时把框展开并接住焦点。
   * 监听挂在 window 上：触发按钮在 App 里，与这个组件不在同一棵子树。
   */
  useEffect(() => {
    if (!listenEvent) return
    const open$ = () => {
      setOpen(true)
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.select()
      })
    }
    window.addEventListener(listenEvent, open$)
    return () => window.removeEventListener(listenEvent, open$)
  }, [listenEvent])

  if (!open) {
    if (hideTrigger) return null
    return (
      <button
        type="button"
        className="shelf-search__trigger"
        onClick={() => setOpen(true)}
        title="在这份列表里筛选"
        aria-label="在这份列表里筛选"
      >
        <Search size={15} />
      </button>
    )
  }

  return (
    <div className="shelf-search">
      <div className="shelf-search__box">
        <Search size={14} />
        <input
          ref={input}
          autoFocus
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // 敲回车才算「这次搜索用过了」——逐字记录会把历史冲成半截词。
            if (event.key === 'Enter' && value.trim()) setRecent(rememberSearch(value))
            // 空着按 Esc 收起这颗框，让它在页面上重新变回一颗键。
            if (event.key === 'Escape' && value === '') setOpen(false)
          }}
          onBlur={() => {
            if (value === '') setOpen(false)
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
