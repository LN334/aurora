import { useRef } from 'react'
import { ChevronLeft, ChevronRight, Close, Search } from '../ui/icons'
import { BrandMark } from './BrandMark'

/**
 * 窗口顶部那一条：去哪儿、找什么、顺手能做什么。
 *
 * 最左边是品牌，点它回「现在」。它中途搬到过左栏顶上——那时左栏还有一整个
 * 大标题，两个品牌名抢同一块地方；现在左栏顶上空了，这里才是它该在的地方：
 * 一个窗口的第一眼认得出这是哪个应用，而不是认出一排按钮。
 *
 * 品牌后面是前进后退。
 *
 * 中间是搜索，全应用唯一的一个框。它曾经是两个长得一样、做的事不同的输入框：
 * 这一个过滤曲库，在线页那个发请求。现在范围写在占位符里，回车才发起请求。
 *
 * 右边不再放动作。队列在播放条上已经有一个按钮，同一件事开两个口子，用户
 * 会以为它们不一样；漫游也回了左栏，跟「现在」并列——都是「不用挑、直接听」。
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
  /** 点品牌回「现在」。 */
  onHome: () => void
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
  onHome
}: TitleBarProps) {
  const field = useRef<HTMLInputElement>(null)
  const typed = query.length > 0

  return (
    <header className="titlebar">
      <button
        type="button"
        className="titlebar__brand"
        onClick={onHome}
        title="回到现在"
      >
        <BrandMark size={20} />
        <span>Aurora</span>
      </button>

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
    </header>
  )
}
