import type { ReactNode } from 'react'

/**
 * 设置页的排版零件。
 *
 * 三级层级由此固定下来：页标题由 SettingsPage 打印，页内每一块是 SettingsCard，
 * 卡片里每一行是 Row（名称 + 一句说明 + 右侧控件）。颜色与字号仍取自 tokens.css。
 */

interface SettingsCardProps {
  title: string
  /** 卡片标题下的一句总述；没有就不占一行。 */
  hint?: string
  children: ReactNode
}

/** 页内的一张卡：一个主题的若干行。 */
export function SettingsCard({ title, hint, children }: SettingsCardProps) {
  return (
    <section className="set-card">
      <header className="set-card__head">
        <h3 className="set-card__title">{title}</h3>
        {hint ? <p className="set-card__hint">{hint}</p> : null}
      </header>
      <div className="set-card__body">{children}</div>
    </section>
  )
}

/** 行容器。只负责去掉第一行的上边框，分组语义交给卡片。 */
export function Rows({ children }: { children: ReactNode }) {
  return <div className="set-rows">{children}</div>
}

interface RowProps {
  label: string
  /**
   * 名称下面的一句说明：这一项做什么、什么时候会用到、代价是什么。
   *
   * 上一版为了「不像说明书」把说明全删了，结果八十几行只剩名字，用户得靠猜。
   * 现在只写非重复的信息，不把控件本身再念一遍。
   */
  desc?: string
  /** 跟在名称后的短状态，比如「还没启动」「已释放 120 MB」。 */
  aside?: ReactNode
  /** 搜索跳转的锚点，同时用于高亮。 */
  id?: string
  /** 悬停提示，放长路径这类一行塞不下的文本。 */
  title?: string
  /** 控件另起一行铺满：滑块、排序表、壁纸库这类。 */
  stack?: boolean
  /** 控件需要更宽的位置（滑块、分段按钮多）。 */
  wide?: boolean
  children: ReactNode
}

/** 一行设置：左名称与说明，右控件。 */
export function Row({ label, desc, aside, id, title, stack, wide, children }: RowProps) {
  return (
    <div
      className={'settings__row' + (stack ? ' settings__row--stacked' : '')}
      data-set-key={id}
    >
      <div className="settings__text">
        <div className="settings__label" title={title}>
          {label}
          {aside ? <span className="settings__aside">{aside}</span> : null}
        </div>
        {desc ? <p className="settings__desc">{desc}</p> : null}
      </div>
      <div className={'settings__control' + (wide ? ' settings__control--wide' : '')}>
        {children}
      </div>
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

/** 行下方的一排按钮（更改目录、扫描、清空）。 */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="set-actions">{children}</div>
}

interface ChoiceOption<T extends string> {
  id: T
  name: string
}

interface ChoiceProps<T extends string> {
  value: T
  options: ChoiceOption<T>[]
  label: string
  disabled?: boolean
  onChange: (next: T) => void
}

/** 一排互斥的小按钮，包住 .seg 的样式与无障碍属性。 */
export function Choice<T extends string>({ value, options, label, disabled, onChange }: ChoiceProps<T>) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={option.id === value ? 'is-active' : ''}
          aria-pressed={option.id === value}
          disabled={disabled}
          onClick={() => onChange(option.id)}
        >
          {option.name}
        </button>
      ))}
    </div>
  )
}

interface NoteProps {
  tone?: 'info' | 'warn' | 'danger'
  children: ReactNode
}

/** 卡片底部的一句提示或警告。 */
export function Note({ tone = 'info', children }: NoteProps) {
  return <p className={`set-note set-note--${tone}`}>{children}</p>
}
