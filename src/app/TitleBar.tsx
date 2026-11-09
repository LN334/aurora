import { useRef } from 'react'
import { ChevronLeft, ChevronRight, Close, Queue, Search, Shuffle } from '../ui/icons'

/**
 * 窗口顶部那一条：去哪儿、找什么、顺手能做什么。
 *
 * 左边只剩前进后退。品牌名搬到了左栏顶上——它原来在这里，跟左栏那个大标题
 * 抢同一块地方，而且顶栏最左边放品牌会让「后退」按钮离窗口边缘很远。
 *
 * 中间是搜索，全应用唯一的一个框。它曾经是两个长得一样、做的事不同的输入框：
 * 这一个过滤曲库，在线页那个发请求。现在范围写在占位符里，回车才发起请求。
 *
 * 右边是两枚动作，不是两个页面：
 *
 * - 队列：听什么、接下来听什么，是一个随时要看一眼的面板，不是一页。
 * - 漫游：它不整理任何东西，只是随机放点什么。以前它在左栏，跟「推荐」「我
 *   喜欢的」并列，读起来像第四个库；它其实是一个动词。
 */
interface TitleBarProps {
  query: string
  onQuery: (query: string) => void
  /** Enter. For modes where searching is a request rather than live filtering. */
  onSubmit?: () => void
  /** Focus. The results panel opens on the field being used, not on a page change. */
  onFocus?: () => void
  placeholder: string
  hint?: string
  shortcut?: string
  onBack: () => void
  onForward: () => void
  canBack: boolean
  canForward: boolean
  /** 队列里有几首；0 时不显示数字，只留动作。 */
  queueCount: number
  onOpenQueue: () => void
  onRoam: () => void
}

export function TitleBar({
  query,
  onQuery,
  onSubmit,
  onFocus,
  placeholder,
  hint,
  shortcut,
  onBack,
  onForward,
  canBack,
  canForward,
  queueCount,
  onOpenQueue,
  onRoam
}: TitleBarProps) {
  const field = useRef<HTMLInputElement>(null)
  const typed = query.length > 0

  return (
    <header className="titlebar">
      <div className="titlebar__history">
        <button
          className="icon-btn"
          onClick={onBack}
          disabled={!canBack}
          title="后退"
          aria-label="后退"
        >
          <ChevronLeft size={17} />
        </button>
        <button
          className="icon-btn"
          onClick={onForward}
          disabled={!canForward}
          title="前进"
          aria-label="前进"
        >
          <ChevronRight size={17} />
        </button>
      </div>

      <form
        className="search"
        role="search"
        title={hint ? `搜索范围：${hint}` : undefined}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit?.()
        }}
      >
        <Search size={15} />
        <input
          ref={field}
          id="global-search"
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onFocus={onFocus}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            /*
             * Escape used to be swallowed by the global shortcut handler, which
             * ignores keys typed into an input - so the field had no way out.
             * First press drops the text, second one leaves the field.
             */
            if (typed) onQuery('')
            else field.current?.blur()
          }}
        />
        {typed ? (
          <button
            type="button"
            className="search__clear"
            title="清空"
            aria-label="清空搜索"
            onClick={() => {
              onQuery('')
              field.current?.focus()
            }}
          >
            <Close size={12} />
          </button>
        ) : null}
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </form>

      <div className="titlebar__spacer" />

      <div className="titlebar__acts">
        <button className="tbar-btn" onClick={onOpenQueue} title="播放队列 (Ctrl P)">
          <Queue size={15} />
          <span>队列</span>
          {queueCount > 0 ? <b className="tbar-btn__num">{queueCount}</b> : null}
        </button>
        <button className="tbar-btn" onClick={onRoam} title="随机放点什么 (R)">
          <Shuffle size={15} />
          <span>漫游</span>
        </button>
      </div>
    </header>
  )
}
