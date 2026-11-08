import { useRef } from 'react'
import { ChevronLeft, ChevronRight, Close, Search } from '../ui/icons'
import { BrandMark } from './BrandMark'

/**
 * The one search field in the app.
 *
 * It used to be two fields that looked identical and did different things: this
 * one filtered the local library, and the online screen had its own box that sent
 * a request to Netease. On the online screen this one silently did nothing - it
 * filtered a list that screen does not show - which reads as a broken input.
 *
 * So the field is now explicit about what it searches, and the caller decides what
 * that means: filter the tracks already here, or query the catalogue. One control,
 * one thing to learn, and the mode is stated in the placeholder rather than left to
 * be discovered by typing into something that does not respond.
 *
 * It is a form rather than a bare input so that Enter works for the request-based
 * mode; live filtering simply ignores the submit.
 */
interface TitleBarProps {
  query: string
  onQuery: (query: string) => void
  /** Enter. For modes where searching is a request rather than live filtering. */
  onSubmit?: () => void
  /** Focus. The results panel opens on the field being used, not on a page change. */
  onFocus?: () => void
  /** What this field searches right now, as the placeholder. */
  placeholder: string
  /** The full scope, shown on hover. The placeholder stays short; this does not. */
  hint?: string
  /** Keyboard hint; omit for modes with no shortcut worth teaching. */
  shortcut?: string
  onBack: () => void
  onForward: () => void
  canBack: boolean
  canForward: boolean
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
  canForward
}: TitleBarProps) {
  const field = useRef<HTMLInputElement>(null)
  const typed = query.length > 0

  return (
    <header className="titlebar">
      <div className="titlebar__mark">
        <BrandMark size={21} />
        <span className="titlebar__wordmark">Aurora</span>
      </div>

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
