import { useLayoutEffect, useRef } from 'react'
import { Close } from './icons'
import { useToast } from './toast'
import type { ToastItem } from './toast'

/**
 * 提示列的渲染部分。
 *
 * 自己不带位置——外层 `.toasts` 是那一列（右下、贴着播放条），这里只负责把
 * store 里的几条按顺序铺开。更新提示也是同一层里的一个兄弟节点，由 App 摆进来，
 * 所以「更新在上、操作反馈在下」这个顺序由 DOM 顺序决定，不靠 z-index 抢。
 *
 * 两处动画在这里落地：
 *   - 新的一条从下沿淡入、老的一条往上让位（FLIP：先量出它被推上去多少，再用
 *     transform 从旧位置滑到新位置，最后交给布局）；
 *   - 收起来时先在 store 里标成 leaving，CSS 把透明度与位移过渡掉，200ms 后才
 *     真从数组里删——直接删会让它下面的卡片瞬移一格。
 */
export function ToastStack() {
  const items = useToast((state) => state.items)
  const dismiss = useToast((state) => state.dismiss)
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const tops = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const alive = new Set<string>()
    for (const item of items) {
      const node = nodes.current.get(item.id)
      if (!node) continue
      alive.add(item.id)
      const top = node.getBoundingClientRect().top
      const previous = tops.current.get(item.id)
      tops.current.set(item.id, top)
      /* 正在退场的那条不动：它的位置变化是「消失」，不是「被顶上去」。 */
      if (item.leaving) continue
      if (previous === undefined || Math.abs(previous - top) < 0.5) continue
      /*
       * 布局已经把它放到了新位置，这里先把它「按回」旧位置再放开：浏览器会
       * 从第一帧的位置插值到 0，看起来就是被新来的那张推上去。
       */
      node.animate(
        [{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      )
    }
    for (const id of [...tops.current.keys()]) if (!alive.has(id)) tops.current.delete(id)
  }, [items])

  if (items.length === 0) return null

  return (
    <>
      {items.map((item) => (
        <ToastCard
          key={item.id}
          item={item}
          onDismiss={() => dismiss(item.id)}
          register={(node) => {
            if (node) nodes.current.set(item.id, node)
            else nodes.current.delete(item.id)
          }}
        />
      ))}
    </>
  )
}

function ToastCard({
  item,
  onDismiss,
  register
}: {
  item: ToastItem
  onDismiss(): void
  register(node: HTMLDivElement | null): void
}) {
  return (
    <div
      ref={register}
      className={`toast toast--${item.tone}${item.leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="toast__text">{item.message}</span>
      {item.action ? (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            item.action?.onSelect()
            onDismiss()
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button type="button" className="toast__close" onClick={onDismiss} title="关闭" aria-label="关闭提示">
        <Close size={13} />
      </button>
    </div>
  )
}
