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

/** 推荐专辑那排的横条：两行四列，占位和真卡同尺寸。 */
export function SkeletonAlbums({ count }: { count: number }) {
  return (
    <div className="rh-alb-list" aria-hidden="true">
      {Array.from({ length: count }, (_, at) => (
        <div className="rh-alb-row is-sk" key={'sk-alb-' + at}>
          <span className="rh-alb-row__art" style={tint('sk-alb-' + at)} />
          <span className="rh-alb-row__main">
            <span className="rh-alb-row__title">{NBSP}</span>
            <span className="rh-alb-row__sub">{NBSP}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** 首页新歌：左边一张主推、右边一列行，占位和真卡同构。 */
export function SkeletonFresh({ rows }: { rows: number }) {
  return (
    <div className="rh-fresh" aria-hidden="true">
      <div className="rh-fresh__lead is-sk">
        <span className="rh-fresh__lead-art" style={tint('sk-fresh-lead')} />
        <span className="rh-fresh__lead-kicker">{NBSP}</span>
        <span className="rh-fresh__lead-title">{NBSP}</span>
        <span className="rh-fresh__lead-sub">{NBSP}</span>
      </div>
      <div className="rh-fresh__list">
        {Array.from({ length: rows }, (_, at) => (
          <div className="rh-fresh__row is-sk" key={'sk-fresh-' + at}>
            <span className="rh-fresh__row-idx" />
            <span className="rh-fresh__row-art" style={tint('sk-fresh-row-' + at)} />
            <span className="rh-fresh__row-main">
              <span className="rh-fresh__row-title">{NBSP}</span>
              <span className="rh-fresh__row-sub">{NBSP}</span>
            </span>
            <span className="rh-fresh__row-dur" />
          </div>
        ))}
      </div>
    </div>
  )
}
