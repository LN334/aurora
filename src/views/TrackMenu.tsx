import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isNative } from '../bridge'
import { toggleLiked, useLiked } from '../features/favorites/likes'
import { showFlash } from '../ui/flash'
import type { Track } from '../types'

interface TrackMenuProps {
  track: Track
  /** Where the pointer asked for it, in viewport coordinates. */
  x: number
  y: number
  playlists: { id: string; name: string }[]
  onClose(): void
  /** 三页里的第一层：先看这首歌是什么，再决定听不听。 */
  onOpenDetail(): void
  onPlayNext(): void
  onAddToPlaylist(playlistId: string): void
  onReveal(): void
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
  onAddToPlaylist,
  onReveal
}: TrackMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  // 本地和在线来源共用同一条判断，菜单不再自己翻收藏数组。
  const liked = useLiked(track)
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
      className="menu"
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

      <button
        className="menu__item"
        role="menuitem"
        onClick={() => {
          onClose()
          // 在线歌要写平台账号，失败必须说一句，不能点了没变化。
          void toggleLiked(track).then((result) => {
            if (!result.ok && result.message) showFlash(result.message)
          })
        }}
      >
        {liked ? '取消喜欢' : '喜欢'}
      </button>

      <div className="menu__sep" role="separator" />

      <div className="menu__label">加入播放列表</div>
      <div className="menu__scroll">
        {playlists.length === 0 ? (
          <div className="menu__empty">还没有播放列表</div>
        ) : (
          playlists.map((playlist) => (
            <button
              key={playlist.id}
              className="menu__item"
              role="menuitem"
              onClick={() => onAddToPlaylist(playlist.id)}
            >
              {playlist.name}
            </button>
          ))
        )}
      </div>

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
