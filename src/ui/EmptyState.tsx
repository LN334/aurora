import type { ReactNode } from 'react'

/**
 * 一页读不到东西时的那一块。
 *
 * 默认档（搜索面板用）：图标、标题、说明、出口。
 *
 * 舞台档（歌单 / 收藏专辑 / 关注艺人）：只留一块景和一个出口。不写标题、不写
 * 说明——页头上已经写着这是哪一页，内容区再挂一句「还没有歌单」只是把「这里没
 * 东西」重复一遍。空页最该做的是别让这块地荒着，不是替它写注解。
 */
/** 空页上十个压痕位的键。数量定死：5 列 2 行，正好是这一页将来会有的样子。 */
const MARKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

export function EmptyState({
  icon,
  title,
  hint,
  action,
  stage = false
}: {
  icon?: ReactNode
  title?: ReactNode
  hint?: ReactNode
  action?: ReactNode
  /** 舞台档：整块内容区就是一幕极光，中间只浮一个出口。 */
  stage?: boolean
}) {
  if (stage) {
    return (
      <div className="pg-stage">
        <div className="pg-stage__field" aria-hidden="true">
          {MARKS.map((mark) => (
            <i className="pgmark" key={mark} />
          ))}
        </div>
        {action ? <div className="pg-stage__act">{action}</div> : null}
      </div>
    )
  }

  return (
    <div className="pg-empty">
      {icon ? <span className="pg-empty__icon">{icon}</span> : null}
      {title ? <h2>{title}</h2> : null}
      {hint ? <p>{hint}</p> : null}
      {action}
    </div>
  )
}