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
          <i className="pg-stage__band pg-stage__band--a" />
          <i className="pg-stage__band pg-stage__band--b" />
          <i className="pg-stage__band pg-stage__band--c" />
          <i className="pg-stage__horizon" />
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