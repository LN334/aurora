import type { ReactNode } from 'react'

/**
 * 单页设置的排版零件。
 *
 * 版式：一行 label 左、控件右。颜色、字号、圆角全部取自 src/styles/tokens.css。
 *
 * 页面标题由外壳（App.tsx 的 main__header）打印，这里只负责分区内的层级。
 */

interface PartProps {
  /** 分区中文名。 */
  zh: string
  /** 左侧目录跳过来用的锚点。 */
  id?: string
  children: ReactNode
}

/**
 * 一个分区。
 *
 * 不再打区名：顶上那条分区带已经把当前是哪一段标出来了，再写一遍只是把同一句
 * 话说两次。`zh` 留给无障碍标签，`id` 留给锚点。
 */
export function Part({ zh, id, children }: PartProps) {
  return (
    <section className="rh-sec set-part" aria-label={zh} id={id ? `set-${id}` : undefined}>
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
