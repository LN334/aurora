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

interface HoverPoll {
  /** 指针是否在这条歌词上（决定控制条浮不浮出来）。 */
  hovering: boolean
  /** 指针是否落在控制条上（锁定时只有这里接管鼠标）。 */
  pointerInToolbar: boolean
  /** 这一次要不要接管鼠标。 */
  takeOver: boolean
}

/**
 * 锁定态下 70ms 轮询一次的全部判定。
 *
 * 抽出来的原因和上面三条规则一样：接线错了没人看得出来。上一版就是主进程里
 * `if (locked || !hoverTakesOver()) return` 把整段判定变成死代码——锁上之后再
 * 也不计算指针位置，控制条永不出现，用户也就再也点不到解锁键。这种错误纯函数
 * 测不出来，得让判定本身有个入口，测试直接问「锁着、指针在字上，控制条该不该
 * 出来」。
 */
export function pollHover(args: {
  locked: boolean
  /** 设置里「悬停时临时接管」那一位。 */
  hoverControls: boolean
  point: Point
  origin: Point
  hitArea: Box | null
  toolbarArea: Box | null
}): HoverPoll {
  if (!args.locked) {
    // 解锁时整窗可交互，轮询不参与判定。
    return { hovering: false, pointerInToolbar: false, takeOver: true }
  }
  const onWords = pointInBox(args.point, args.origin, args.hitArea)
  const onTools = pointInBox(args.point, args.origin, args.toolbarArea)
  const hovering = args.hoverControls && shouldShowControls({ locked: true, hovering: onWords || onTools })
  const pointerInToolbar = args.hoverControls && onTools
  return {
    hovering,
    pointerInToolbar,
    takeOver: shouldTakeOver({ locked: true, hoverControls: args.hoverControls, pointerInToolbar })
  }
}
