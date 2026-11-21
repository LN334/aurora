/**
 * 桌面歌词窗口的鼠标判定。
 *
 * 单独放在 pure/ 下是因为上一轮踩过：同一段判定写在主进程里，靠肉眼和录屏
 * 看「锁了之后点得到点不到」，改一次要重开窗口、移鼠标、再看一遍，代价高还
 * 说不清边界。这里把三条规则抽成纯函数，`node --test` 直接跑。
 *
 * 三条规则：
 *  1. 未锁定：整窗可交互（要能拖动、点歌词跳转）。
 *  2. 锁定：整窗穿透——**包括歌词文字**，鼠标悬在字上也必须落到桌面上。
 *  3. 锁定 + 允许悬停：只有控制条那一块接管鼠标，好让用户点得到播放与解锁；
 *     控制条浮出来这件事本身不改变穿透。
 */

interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

/**
 * 光标是否落在某个盒子里。
 *
 * `origin` 是窗口在屏幕上的位置，盒子用的是窗口内坐标（渲染层上报的
 * `getBoundingClientRect()` 就是这一套）。`pad` 给一点余量：控制条是圆角小矩形，
 * 差两像素点不上会让人以为坏了。
 */
export function pointInBox(point: Point, origin: Point, box: Box | null, pad = 4): boolean {
  if (!box) return false
  const left = origin.x + box.x - pad
  const top = origin.y + box.y - pad
  const right = origin.x + box.x + box.width + pad
  const bottom = origin.y + box.y + box.height + pad
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
}

/** 这次要不要接管鼠标（返回 true = 窗口吃点击，false = 穿透到桌面）。 */
export function shouldTakeOver(args: {
  locked: boolean
  hoverControls: boolean
  pointerInToolbar: boolean
}): boolean {
  if (!args.locked) return true
  if (!args.hoverControls) return false
  return args.pointerInToolbar
}

/** 控制条要不要显示。锁定时只在自己被悬停时出来；解锁时常驻。 */
export function shouldShowControls(args: { locked: boolean; hovering: boolean }): boolean {
  return !args.locked || args.hovering
}
