import { Refresh } from '../../ui/icons'
import type { WallpaperEntry } from '../../env'
import { FOLLOW_SELECTION } from '../../features/wallpaper/pure'

/**
 * The wallpaper library grid.
 *
 * Only the grid lives here, not the rows around it: the settings page already
 * owns the label/hint/control rhythm, and duplicating it would drift. What this
 * component keeps is the one thing that is genuinely wallpaper-specific - the
 * "follow Wallpaper Engine" card, which is a choice that has no project id.
 */

const KIND_LABELS: Record<WallpaperEntry['kind'], string> = {
  video: '视频',
  web: '网页',
  scene: '场景',
  image: '图片',
  none: '无'
}

interface WallpaperGridProps {
  list: WallpaperEntry[]
  /** A project id, or `FOLLOW_SELECTION`. */
  selection: string
  /**
   * 桌面此刻那张壁纸的预览图（Wallpaper Engine 报上来的）。
   *
   * 「跟随当前壁纸」原先只摆一个 ⟳，用户看不出「当前」到底是哪一张——尤其 WE
   * 自己在轮播时。有图就画图，没图（没装 WE / 那张没有缩略图）才退回那个符号。
   */
  followPreview?: string | null
  onSelect: (id: string) => void
}

export function WallpaperGrid({ list, selection, followPreview, onSelect }: WallpaperGridProps) {
  return (
    <div className="wp-grid" role="list" aria-label="壁纸库">
      {/*
        Follow is first because it is the default: most users want the player to
        match the desktop, and Wallpaper Engine already has a playlist feature for
        people who want rotation.
      */}
      <button
        className={`wp-card${selection === FOLLOW_SELECTION ? ' is-active' : ''}`}
        role="listitem"
        title="跟随 Wallpaper Engine 当前使用的壁纸"
        onClick={() => onSelect(FOLLOW_SELECTION)}
      >
        <span className="wp-card__art wp-card__art--follow">
          {followPreview ? (
            <img src={followPreview} alt="" loading="lazy" decoding="async" />
          ) : (
            <Refresh size={18} />
          )}
        </span>
        <span className="wp-card__title">跟随当前壁纸</span>
      </button>

      {list.map((entry) => (
        <button
          key={entry.id}
          className={`wp-card${selection === entry.id ? ' is-active' : ''}`}
          role="listitem"
          title={entry.title}
          onClick={() => onSelect(entry.id)}
        >
          <span className="wp-card__art">
            {entry.previewUrl ? (
              <img src={entry.previewUrl} alt="" loading="lazy" decoding="async" />
            ) : (
              <span className="wp-card__noart">无预览</span>
            )}
            {/*
              The kind badge is not decoration: a scene project renders inside the
              shell through WebGL, while a web project is an iframe that can be slow
              to load. Knowing which one is selected explains both.
            */}
            <span className="wp-card__kind-badge">{KIND_LABELS[entry.kind]}</span>
            {entry.current ? <span className="wp-card__badge">WE 在用</span> : null}
          </span>
          <span className="wp-card__title">{entry.title}</span>
        </button>
      ))}
    </div>
  )
}
