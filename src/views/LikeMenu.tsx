import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { likeTargets } from '../features/favorites/like-targets'
import { toggleLiked, useLikedIds } from '../features/favorites/likes'
import { useLikeMenu } from '../features/favorites/like-menu'
import { showFlash } from '../ui/flash'
import { Heart } from '../ui/icons'
import { useLeave } from '../ui/presence'
import './LikeMenu.css'

const MARGIN = 8

/**
 * 多平台版本的歌点红心时，先问收藏到哪儿。
 *
 * 只有一个落点时不走这里——那种情况直接切换，多一次点击只是多一道门。
 * 这里列出的每一行都是真实存在的那一版，点哪行就写哪家账号，
 * 所以「喜欢」在四家平台之间不会互相顶掉。
 */
export function LikeMenu() {
  const request = useLikeMenu((state) => state.open)
  const close = useLikeMenu((state) => state.close)
  /*
   * 关闭也走退场：store 里的 request 一旦置空组件立刻被摘掉，动画来不及跑。
   * 所以先挂 150ms 的 leaving，再真的 close。
   */
  const { leaving, leave } = useLeave(150)
  const closeMenu = useCallback(() => leave(close), [leave, close])
  const likedIds = useLikedIds()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  const targets = useMemo(() => (request ? likeTargets(request.track) : []), [request])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !request) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(MARGIN, Math.min(request.x, window.innerWidth - rect.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(request.y, window.innerHeight - rect.height - MARGIN))
    })
  }, [request])

  useEffect(() => {
    if (!request) return
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) closeMenu()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeMenu()
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [request, closeMenu])

  if (!request) return null

  return (
    <div
      className={'lk-menu' + (leaving ? ' is-closing' : '')}
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      aria-label="收藏到哪个平台"
    >
      <p className="lk-menu__head">喜欢到哪儿</p>
      {targets.map((target) => {
        const liked = likedIds.has(target.track.id)
        return (
          <button
            key={target.source}
            className={'lk-menu__item' + (liked ? ' is-liked' : '') + (target.writable ? '' : ' is-off')}
            role="menuitemcheckbox"
            aria-checked={liked}
            disabled={!target.writable}
            title={target.writable ? undefined : '这家还没有收藏接口'}
            onClick={() => {
              void toggleLiked(target.track).then((result) => {
                if (!result.ok) {
                  if (result.message) showFlash(result.message)
                } else {
                  showFlash(liked ? '已从' + target.label + '取消喜欢' : '已收藏到' + target.label)
                }
              })
              closeMenu()
            }}
          >
            <Heart size={13} />
            <span className="lk-menu__name">{target.label}</span>
            <span className="lk-menu__state">
              {target.writable ? (liked ? '已喜欢' : '未喜欢') : '没有收藏接口'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
