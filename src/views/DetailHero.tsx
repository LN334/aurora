import type { ReactNode } from 'react'

/**
 * 详情页的共用页头：一张大图、一个标题、一行事实、一排动作。
 *
 * 专辑、艺人、歌单三页的差别只在数据，不在版式——所以头只写一次。三页各自
 * 造一套头，是上一版「每页都像另一个 App」的来源之一。
 *
 * 图可以是方形（专辑、歌单）也可以是圆的（艺人），由内部包一层裁剪决定。
 */
export function DetailHero({
  art,
  round,
  kicker,
  title,
  meta,
  actions,
  children
}: {
  art: ReactNode
  round?: boolean
  kicker?: ReactNode
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="dh">
      <div className={'dh__art' + (round ? ' dh__art--round' : '')}>{art}</div>
      <div className="dh__body">
        {kicker ? <span className="dh__kicker">{kicker}</span> : null}
        <h1 className="dh__title">{title}</h1>
        {meta ? <div className="dh__meta">{meta}</div> : null}
        {actions ? <div className="dh__actions">{actions}</div> : null}
        {children}
      </div>
    </header>
  )
}
