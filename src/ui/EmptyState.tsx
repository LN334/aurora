import type { ReactNode } from 'react'

/**
 * 一页读不到东西时的那一块。
 *
 * 这几个页面以前各写各的：有的只有一行标题，有的多一句说明，有的还挂一颗
 * 按钮——字号、间距、上下位置都不一样。同一个应用里出现四五种「空」，读的人
 * 分不清是「这里确实没有」还是「这页坏了」。
 *
 * 现在统一成四件：一个图标、一句标题、一句说明、一个出口动作。图标用各页
 * 自己的语义（歌、专辑、艺人、歌单），不再是清一色的灰字。
 */
export function EmptyState({
  icon,
  title,
  hint,
  action
}: {
  icon?: ReactNode
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="pg-empty">
      {icon ? <span className="pg-empty__icon">{icon}</span> : null}
      <h2>{title}</h2>
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  )
}
