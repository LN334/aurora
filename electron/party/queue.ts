/**
 * 房间队列的三条操作：加、删、挪。
 *
 * 抽成纯函数是为了能直接跑 `node --test`——房间列表的那些判断（同一首重复加
 * 算不算两次、挪动了却没变化要不要广播）全靠它，而真的开两个窗口去点，一次
 * 只能验一条。
 *
 * 队列是「接下来要放的」，不含正在放的那首；正在放的那首在 `PartyState.now`
 * 里。所以这里没有「删掉正在放的那首」这种事：界面只在 now 那一行给播放，不
 * 给删。
 *
 * 没变化时返回**原数组引用**，调用方用 `next === queue` 就能判断该不该广播。
 * 房间状态是整包广播，一次多余推送等于给每个成员多发一份队列。
 */

/** 队列只认这个：`id` 是跨端稳定的曲目键（`source:onlineId` 或本机路径）。 */
interface QueueLike {
  id: string
}

/** 队列最多留这么多首，再多就是有人在刷。 */
export const QUEUE_MAX = 500

/** 加到队尾；已经在队列里、或队列满了，原样返回。 */
export function addToQueue<T extends QueueLike>(queue: T[], item: T): T[] {
  if (queue.some((each) => each.id === item.id)) return queue
  if (queue.length >= QUEUE_MAX) return queue
  return [...queue, item]
}

/** 从队列里拿掉一首；不在里面就原样返回。 */
export function removeFromQueue<T extends QueueLike>(queue: T[], id: string): T[] {
  const at = queue.findIndex((each) => each.id === id)
  if (at < 0) return queue
  return [...queue.slice(0, at), ...queue.slice(at + 1)]
}

/**
 * 把一首挪到第 `to` 位。
 *
 * 下标按「挪完之后的队列」算：3 挪到 0 就是从第三位提到第一位，其余依次后退。
 * 越界夹在两端——拖拽松手算出负数或超出长度是常事，不该因此把这首歌丢掉。
 */
export function moveInQueue<T extends QueueLike>(queue: T[], id: string, to: number): T[] {
  const at = queue.findIndex((each) => each.id === id)
  if (at < 0) return queue
  if (!Number.isFinite(to)) return queue
  const target = Math.max(0, Math.min(queue.length - 1, Math.trunc(to)))
  if (target === at) return queue
  const next = [...queue]
  const [moved] = next.splice(at, 1)
  next.splice(target, 0, moved)
  return next
}
