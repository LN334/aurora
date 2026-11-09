import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isNative } from '../bridge'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { likeTargets } from '../features/favorites/like-targets'
import { useLikeMenu } from '../features/favorites/like-menu'
import { showFlash } from '../ui/flash'
import type { Track } from '../types'

interface TrackMenuProps {
  track: Track
  /** Where the pointer asked for it, in viewport coordinates. */
  x: number
  y: number
  /** 能加进去的平台歌单。本机不存歌单，所以这一列全是平台账号里的单子。 */
  playlists: { key: string; name: string; providerLabel: string }[]
  onClose(): void
  /** 三页里的第一层：先看这首歌是什么，再决定听不听。 */
  onOpenDetail(): void
  onPlayNext(): void
  /** 从这一首出发开一趟漫游：按同专辑、同艺人往外扩。 */
  onRoam?: () => void
  /**
   * 把这首歌存到本地。本机文件已经在磁盘上，所以那种行不会拿到这个回调，
   * 菜单里也不该出现一个按了没反应的「下载」。
   */
  onDownload?: () => void
  onAddToPlaylist(key: string): void
  /** 这一行来自某张平台歌单时，才给「从这张歌单移除」。 */
  onRemoveFromPlaylist?: () => void
  onReveal(): void
  /**
   * 正在退场。由 App 在关闭后先挂 200ms 再卸载，菜单据此放一段缩小淡出；
   * 动作本身（切歌、加入队列）早已执行，这一层只是让它消失得不像被掐掉。
   */
  closing?: boolean
}

const MARGIN = 8

/**
 * The per-track actions menu.
 *
 * Positioned at the pointer but clamped into the viewport: a menu opened near the
 * bottom-right corner would otherwise be drawn mostly off-screen, which reads as
 * the menu being broken rather than as a positioning bug.
 */
export function TrackMenu({
  track,
  x,
  y,
  playlists,
  onClose,
  onOpenDetail,
  onPlayNext,
  onRoam,
  onDownload,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onReveal,
  closing = false
}: TrackMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  // 整行判定：合并行里喜欢的是另一家的版本时，这一项也得说「取消喜欢」。
  const likedIds = useLikedIds()
  const liked =
    likedIds.has(track.id) || (track.versions ?? []).some((version) => likedIds.has(version.id))
  const [pos, setPos] = useState({ left: x, top: y })
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))

  /*
   * Reposition on resize rather than closing.
   *
   * The menu is placed in viewport coordinates, so a resize invalidates where it
   * is. Dismissing it would technically avoid the misplacement, but silently
   * vanishing under the user's pointer is worse than moving: they asked for a
   * menu, and a menu that stays put and stays on screen is the answer.
   */
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(MARGIN, Math.min(x, viewport.width - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, viewport.height - rect.height - MARGIN))
    })
  }, [x, y, viewport])

  useEffect(() => {
    // `pointerdown` rather than `click`: the menu should be gone before the
    // click lands on whatever is underneath it.
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return (
    <div
      className={'menu' + (closing ? ' is-closing' : '')}
      role="menu"
      ref={ref}
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      aria-label={`${track.title} 的操作`}
    >
      <button className="menu__item" role="menuitem" onClick={onOpenDetail}>
        歌曲详情
      </button>

      <button className="menu__item" role="menuitem" onClick={onPlayNext}>
        下一首播放
      </button>

      {onRoam ? (
        <button className="menu__item" role="menuitem" onClick={onRoam}>
          从这首漫游
        </button>
      ) : null}

      {onDownload ? (
        <button className="menu__item" role="menuitem" onClick={onDownload}>
          下载到本地
        </button>
      ) : null}

      <button
        className="menu__item"
        role="menuitem"
        onClick={() => {
          const targets = likeTargets(track)
          if (targets.length > 1) {
            // 多版本时不替用户选平台，交给同一个落点面板。
            useLikeMenu.getState().show({ track, x, y })
            onClose()
            return
          }
          const target = targets[0]
          onClose()
          // 在线歌要写平台账号，失败必须说一句，不能点了没变化。
          if (!target || !target.writable) {
            showFlash('这首歌所在的平台还没有收藏接口')
            return
          }
          void toggleLiked(target.track).then((result) => {
            if (!result.ok) {
              if (result.message) showFlash(result.message)
            } else {
              showFlash(result.liked ? '已收藏到' + target.label : '已从' + target.label + '取消')
            }
          })
        }}
      >
        {liked ? '取消喜欢' : '喜欢'}
      </button>

      <div className="menu__sep" role="separator" />

      <div className="menu__label">加入歌单</div>
      <div className="menu__scroll">
        {playlists.length === 0 ? (
          <div className="menu__empty">还没有能写的歌单</div>
        ) : (
          playlists.map((playlist) => (
            <button
              key={playlist.key}
              className="menu__item menu__item--hint"
              role="menuitem"
              onClick={() => onAddToPlaylist(playlist.key)}
            >
              <span className="menu__name">{playlist.name}</span>
              <span className="menu__hint">{playlist.providerLabel}</span>
            </button>
          ))
        )}
      </div>

      {onRemoveFromPlaylist ? (
        <>
          <div className="menu__sep" role="separator" />
          <button className="menu__item" role="menuitem" onClick={onRemoveFromPlaylist}>
            从这张歌单移除
          </button>
        </>
      ) : null}

      <div className="menu__sep" role="separator" />

      <button
        className="menu__item"
        role="menuitem"
        onClick={onReveal}
        // The browser preview has no filesystem to reveal anything in.
        disabled={!isNative}
        title={isNative ? undefined : '只有桌面版能打开文件所在位置'}
      >
        在文件夹中显示
      </button>
    </div>
  )
}
