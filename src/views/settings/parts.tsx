import type { ReactNode } from 'react'

/**
 * 单页设置的排版零件。
 *
 * 版式借自参考项目（编号方块 + 英文小标 + 中文名 + 右侧发丝线；每行 label 左、控件右），
 * 但颜色、字号、圆角全部取自 src/styles/tokens.css —— 借的是分级方式，不是它的视觉。
 *
 * 页面标题由外壳（App.tsx 的 main__header）打印，这里只负责分区内的层级，
 * 所以没有 h1，编号方块本身就是顺序提示。
 */

interface PartProps {
  /** 两位编号，显示为深色小方块里的数字。 */
  num: string
  /** 编号旁的小号英文小标。 */
  en: string
  /** 分区中文名。 */
  zh: string
  children: ReactNode
}

/** 一个编号分区。 */
export function Part({ num, en, zh, children }: PartProps) {
  return (
    <section className="set-part" aria-label={`${num} ${zh}`}>
      <header className="set-part__head">
        <span className="set-part__num">{num}</span>
        <span className="set-part__en">{en}</span>
        <h2 className="set-part__title">{zh}</h2>
        <span className="set-part__rule" aria-hidden="true" />
      </header>
      <div className="set-part__body">{children}</div>
    </section>
  )
}

interface SubProps {
  /** 分区内的次级小标题，沿用 app 里 .accounts__heading 的 11px 低对比做法。 */
  title: string
  hint?: string
  children: ReactNode
}

/** 分区内的一小节。01 需要它来分开档案、平台、来源与文件夹。 */
export function Sub({ title, hint, children }: SubProps) {
  return (
    <div className="set-sub">
      <div className="set-sub__head">
        <h3 className="set-sub__title">{title}</h3>
        {hint ? <p className="set-sub__hint">{hint}</p> : null}
      </div>
      <div className="set-sub__body">{children}</div>
    </div>
  )
}

/**
 * 一组行。
 *
 * 包一层的目的只是让 .settings__row:first-child 有边框可挂：行自己只画下边线，
 * 一组的第一行需要一条上边线，整组才像参考项目里的那种表格。
 */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="set-rows">{children}</div>
}

interface RowProps {
  label: string
  hint?: string
  /** 悬停提示，给放不下的路径一类的长文本。 */
  title?: string
  children: ReactNode
}

/** 一行设置：左边 label（可带一行说明），右边控件。 */
export function Row({ label, hint, title, children }: RowProps) {
  return (
    <div className="settings__row">
      <div className="settings__text">
        <div className="settings__label" title={title}>
          {label}
        </div>
        {hint ? <p className="settings__hint">{hint}</p> : null}
      </div>
      <div className="settings__control">{children}</div>
    </div>
  )
}

interface ToggleProps {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (next: boolean) => void
}

/** 和 app 其它地方同一个开关，避免这一页看起来像另一个产品。 */
export function Toggle({ checked, label, disabled, onChange }: ToggleProps) {
  return (
    <button
      className={`switch${checked ? ' is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__dot" />
    </button>
  )
}

/** 行下方的一排按钮（添加文件夹、清空缓存、链接）。 */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="set-actions">{children}</div>
}
