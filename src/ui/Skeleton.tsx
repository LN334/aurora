import type { CSSProperties } from 'react'

/**
 * 载入占位。
 *
 * 一律按真实结构的类名来画，不另起一套「骨架样式」：占位的尺寸就来自真卡
 * 自己的 CSS（封面 aspect-ratio、标题行高、行高 60px），所以数据到了填空时
 * 格子不会挪位。这是「打开页面容器大小错位」的正解——不是让数据变快，而是
 * 让框先站住。
 *
 * 文案里塞一个不换行空格而不是留空：空 span 高度是 0，骨架会比真卡矮一行。
 */

const NBSP = '\u00A0'

function tint(seed: string): CSSProperties {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    background: 'linear-gradient(150deg, hsl(' + hue + ' 32% 28% / 0.26), hsl(' + ((hue + 42) % 360) + ' 28% 14% / 0.34))'
  }
}

/** 封面卡网格（首页推荐歌单、歌单页）。 */
export function SkeletonCards({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, at) => (
        <div className="rh-card is-sk" key={'sk-card-' + at} aria-hidden="true">
          <span className="rh-card__art" style={tint('sk-card-' + at)} />
          <span className="rh-card__title">{NBSP}</span>
          <span className="rh-card__sub">{NBSP}</span>
        </div>
      ))}
    </>
  )
}

/** 推荐专辑那排的大卡：两行四列，占位和真卡同尺寸。 */
export function SkeletonAlbums({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, at) => (
        <div className="rh-alb is-sk" key={'sk-alb-' + at} aria-hidden="true">
          <span className="rh-alb__art" style={tint('sk-alb-' + at)} />
          <span className="rh-alb__title">{NBSP}</span>
          <span className="rh-alb__sub">{NBSP}</span>
        </div>
      ))}
    </>
  )
}

/** 曲目列表的行（首页新歌、漫游）。 */
export function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="sk-rows" aria-hidden="true">
      {Array.from({ length: count }, (_, at) => (
        <div className="trk is-sk" key={'sk-row-' + at}>
          <span className="trk__idx" />
          <span className="trk__art" />
          <div className="trk__main">
            <span className="trk__title">
              <span className="trk__title-text">{NBSP}</span>
            </span>
            <span className="trk__sub">{NBSP}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
