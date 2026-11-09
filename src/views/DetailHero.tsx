import type { ReactNode } from 'react'

/**
 * 详情页的共用页头：一张大图、一个标题、一行事实、一排动作，底下一条统计。
 *
 * 专辑、艺人、歌单、歌曲四页的差别只在数据，不在版式——所以头只写一次。四页
 * 各造一套头，是上一版「每页都像另一个 App」的来源之一。
 *
 * 统计条单独占一行而不是挂在右侧一列：一列薄薄的事实表会把正文挤成中间一条
 * 通道，两边空着中间挤；横过来之后数字变大，读的是「这里有多少东西」。
 */
export function DetailHero({
  art,
  round,
  kicker,
  title,
  meta,
  actions,
  stats,
  brief
}: {
  art: ReactNode
  round?: boolean
  kicker?: ReactNode
  title: ReactNode
  /** 标题下面那一行：作者 / 年份 / 曲目数，用分隔点隔开。 */
  meta?: ReactNode
  actions?: ReactNode
  /** 这一页的规模。数值大、说明小，一行横着读完。 */
  stats?: { value: ReactNode; label: string; highlight?: boolean }[]
  /** 一段简介。有就写两行，没有就不占位置。 */
  brief?: string
}) {
  return (
    <>
      <header className="dp">
        <div className={'dp__art' + (round ? ' dp__art--round' : '')}>{art}</div>
        <div className="dp__body">
          {kicker ? <span className="dp__k">{kicker}</span> : null}
          <h1 className="dp__t">{title}</h1>
          {meta ? <div className="dp__m">{meta}</div> : null}
          {actions ? <div className="dp__acts">{actions}</div> : null}
          {brief ? <p className="dp__brief">{brief}</p> : null}
        </div>
      </header>

      {stats && stats.length > 0 ? (
        <div className="dp__stats">
          {stats.map((stat) => (
            <div className={'st' + (stat.highlight ? ' st--hi' : '')} key={stat.label}>
              <b>{stat.value}</b>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  )
}
