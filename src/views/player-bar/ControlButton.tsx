import type { ReactNode } from 'react'

/**
 * 播放条上的每一颗图标键。
 *
 * 单独抽出来，是为了让「默认 / 悬停 / 按下 / 不可用」四种状态只有一处定义：
 * 底栏上的键有十来个，分散写 class 迟早会漏掉一种状态（之前就是只有 `.is-on`
 * 改颜色，没有背景，激活与悬停分不开）。
 *
 * `variant` 只区分两种分量：`ghost` 是次级键（静音、队列、上一首……），
 * `mode` 是模式键（随机、循环），它们比传输键再轻半档，图标也小一号——
 * 五颗一样大排在播放键两侧时，看的人会以为它们和「上一首」是同一层级。
 */
interface ControlButtonProps {
  /** 读屏用的全名。 */
  label: string
  /** 悬浮气泡里的短词。给了才画，避免盖住下面的键。 */
  tip?: string
  /** 原生 title：要带快捷键时用它，气泡仍旧是 tip 那个短词。 */
  hint?: string
  onClick(): void
  disabled?: boolean
  /** 开关型按钮：打开时点亮。 */
  active?: boolean
  /** 开关型按钮必须把状态报给读屏。 */
  pressed?: boolean
  variant?: 'ghost' | 'mode'
  /** 队列那种计数气泡。 */
  badge?: number
  className?: string
  children: ReactNode
}

export function ControlButton({
  label,
  tip,
  hint,
  onClick,
  disabled,
  active,
  pressed,
  variant = 'ghost',
  badge,
  className,
  children
}: ControlButtonProps) {
  const classes = ['pb-btn', `pb-btn--${variant}`]
  if (active) classes.push('is-on')
  if (className) classes.push(className)

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onClick}
      disabled={disabled}
      title={hint ?? tip ?? label}
      data-tip={tip}
      aria-label={label}
      aria-pressed={pressed}
    >
      {children}
      {badge ? <span className="pb-btn__badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  )
}
