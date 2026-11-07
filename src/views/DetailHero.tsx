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
  facts,
  brief,
  children
}: {
  art: ReactNode
  round?: boolean
  kicker?: ReactNode
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  /** 右侧那列事实（平台、发行年、曲目数…）。宽窗口才出现，窄窗直接收起。 */
  facts?: { label: string; value: ReactNode }[]
  /** 一段简介。有就写两行，没有就不占位置。 */
  brief?: string
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
        {brief ? <p className="dh__brief">{brief}</p> : null}
        {children}
        {facts && facts.length > 0 ? (
          <dl className="dh__facts">
            {facts.map((fact) => (
              <div className="dh__fact" key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </header>
  )
}
