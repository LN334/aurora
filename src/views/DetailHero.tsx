import type { ReactNode } from 'react'
import { coverTarget } from '../ui/fly-cover'

/**
 * 详情页的共用页头：一张大图、一个标题、一行事实、一排动作，底下一条统计。
 *
 * 专辑、艺人、歌单、歌曲四页的差别只在数据，不在版式——所以头只写一次。四页
 * 各造一套头，是上一版「每页都像另一个 App」的来源之一。
 *
 * 眉标写成「英文类型 // 中文类型」（PLAYLIST // 歌单），全站所有页头都用这一
 * 个语法：英文给形状，中文给意思。标题和作者之间不画线：页头这么宽，任何一条
 * 横线都会被拉成一根平平的分隔，读者先看见线、后看见字。
 *
 * 统计并进页头、跟在作者那一行底下：详情页的事实只有两三条，做成一整条横贯的
 * 带子（上下两道线、44px 间距、20px 数字）比重比标题还响，还和标题隔着封面那
 * 么高的空白，读起来像正文之前另起的一节。收成一小排，扫完就翻页。
 */
/**
 * 页头逐件入场的时间表。
 *
 * 整块淡入在浅色界面上等于什么都没发生——读者只看见「换了张图」。这里把页头
 * 拆成七件，按阅读顺序依次抬起来：类型、标题、线、事实、动作、统计。每件都比
 * 前一件晚 40–60ms，眼睛会顺着这条线索一路读下去，而不是先看到一整块白。
 */
function delay(ms: number): { animationDelay: string } {
  return { animationDelay: ms + 'ms' }
}

export function DetailHero({
  art,
  round,
  en,
  kicker,
  title,
  meta,
  actions,
  stats,
  brief
}: {
  art: ReactNode
  round?: boolean
  /** 眉标前面的英文类型名：PLAYLIST / ALBUM / ARTIST / TRACK。 */
  en?: string
  kicker?: ReactNode
  title: ReactNode
  /** 标题下面那一行：作者 / 年份 / 曲目数，用分隔点隔开。 */
  meta?: ReactNode
  actions?: ReactNode
  /** 这一页的规模。说明小、数字大，一行横着读完。 */
  stats?: { value: ReactNode; label: string; highlight?: boolean }[]
  /** 一段简介。有就写两行，没有就不占位置。 */
  brief?: string
}) {
  return (
    <>
      <header className="dp">
        <div
          /* 只登记落点，不在这里起飞：起飞的时机归换页那边管（见 fly-cover）。 */
          ref={coverTarget}
          className={'dp__art dp-rise' + (round ? ' dp__art--round' : '')}
          style={delay(0)}
        >
          {art}
        </div>
        <div className="dp__body">
          {en || kicker ? (
            <span className="dp__k dp-rise" style={delay(70)}>
              {en ? (
                <>
                  <b>{en}</b>
                  <i aria-hidden="true">//</i>
                </>
              ) : null}
              {kicker}
            </span>
          ) : null}
          <h1 className="dp__t dp-rise" style={delay(120)}>
            {title}
          </h1>
          {meta ? (
            <div className="dp__m dp-rise" style={delay(180)}>
              {meta}
            </div>
          ) : null}
          {stats && stats.length > 0 ? (
            <div className="dp__stats dp-rise" style={delay(220)}>
              {stats.map((stat) => (
                <div
                  className={'st' + (stat.highlight ? ' st--hi' : '')}
                  key={stat.label}
                >
                  <span>{stat.label}</span>
                  <b>{stat.value}</b>
                </div>
              ))}
            </div>
          ) : null}
          {actions ? (
            <div className="dp__acts dp-rise" style={delay(260)}>
              {actions}
            </div>
          ) : null}
          {brief ? (
            <p className="dp__brief dp-rise" style={delay(300)}>
              {brief}
            </p>
          ) : null}
        </div>
      </header>

    </>
  )
}
