/*
 * 换页转场。
 *
 * 换页靠 key 把整块内容重挂，旧页在同一次提交里就没了——屏幕上只剩新页入场，
 * 于是「点了没反应」。这里把刚摘下来的节点搬到一层 fixed 覆盖层上，让它在
 * 三百毫秒里退焦、上浮、化开，新页在这层下面显影。
 *
 * 搬的是节点本身，不是 clone：克隆要重放图片、重算布局，canvas 还会是空的。
 * 节点已经从文档里摘下来，React 不会再碰它们。
 *
 * 页头也要搬。正文的矩形跟着页头走（有的页没有页头，有的页头高 66px），只搬
 * 正文的话，旧页的上半截会露出新页的页头——那正是要消掉的那种错位。
 *
 * 这里以前放过一道 canvas 画的极光帘幕：从屏底升起，把旧页吃掉。问题在于浅色
 * 白卡加亮壁纸的画面里，任何「从外面盖进来」的东西都会被读成水帘、声波、百叶窗，
 * 除了极光。换页本身也不需要那么多戏——它只要干净、利落、方向一致。
 */

import { flyToRemembered, hasPendingCover } from './fly-cover'

/** 一页的两个可替换块：页头（有的页没有）和正文。 */
export type PageParts = {
  header: HTMLElement | null
  body: HTMLElement
  headH?: number
  /** 上一次提交时页头的 HTML。页头节点会被 React 复用，换页后只剩这份快照。 */
  headHTML?: string
}

/** 换一个页面时，旧页退场用多久。 */
const DURATION = 480

/** 钻详情时旧页退场用多久。比普通换页短，好让封面飞得有干净的背景。 */
const QUIET_DURATION = 380

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/*
 * 快起慢收。
 *
 * 原来是三次 ease-in-out，前 20% 只走掉 3%：点击之后近两百毫秒画面上什么
 * 都没发生，观感就是「点了没反应」。第一下必须立刻见效，所以前段给足速度。
 */
function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 2.1)
}

/** 上一场转场结束的时刻，用来自动跳过同一跳里的重复重建。 */
let cooldownUntil = 0

function ensureGhost(): HTMLElement {
  let ghost = document.getElementById('page-ghost')
  if (!ghost) {
    ghost = document.createElement('div')
    ghost.id = 'page-ghost'
    ghost.className = 'page-ghost'
    ghost.setAttribute('aria-hidden', 'true')
    document.body.appendChild(ghost)
  }
  return ghost
}

/**
 * 把旧页装进覆盖层。
 *
 * 内层做 flex 列：页头按自身高度占位，正文 flex:1 吃掉剩下的。这样就算旧页
 * 有页头，正文的框也和新页一样高，两半在接缝处对得上。
 */
function mountGhost(ghost: HTMLElement, parts: PageParts, rect: DOMRect, scrollTop: number) {
  ghost.style.left = rect.left + 'px'
  ghost.style.top = rect.top + 'px'
  ghost.style.width = rect.width + 'px'
  ghost.style.height = rect.height + 'px'

  /*
   * 页头按旧页的样子复原，但绝不搬节点。
   *
   * 两个坑叠在一起：
   *   1. 页头是同一个 DOM 节点被 React 复用下来的，把它搬进 ghost 等于把新页
   *      的标题抢走，动画一结束 ghost 清空，标题就永久没了（歌单页、设置页的
   *      标题这么消失过）。
   *   2. 只留一块透明占位也不行：那个位置立刻透出下面新页的标题，观感变成
   *      「页已经切好了，动画才来」。
   *
   * 所以用上一次提交时记下的 HTML 复原旧页页头。它是死的 DOM，加 inert 之后
   * 不可聚焦、不可点，跟着旧页一起退场。
   */
  const inner = document.createElement('div')
  inner.className = 'page-ghost__inner'
  const headH = parts.headH ?? parts.header?.offsetHeight ?? 0
  if (headH > 0) {
    const head = document.createElement('div')
    head.className = 'page-ghost__head'
    head.style.height = headH + 'px'
    head.style.overflow = 'hidden'
    if (parts.headHTML) {
      head.innerHTML = parts.headHTML
      const box = head.firstElementChild as HTMLElement | null
      if (box) {
        box.removeAttribute('id')
        box.setAttribute('inert', '')
      }
    }
    inner.appendChild(head)
  }
  inner.appendChild(parts.body)
  ghost.replaceChildren(inner)
  parts.body.scrollTop = scrollTop

  /* 上一次转场可能停在半路，残留的样式要先清干净。 */
  ghost.style.display = ''
  ghost.style.opacity = '1'
  ghost.style.transform = ''
  ghost.style.filter = ''
  ghost.style.maskImage = ''
}

/**
 * 旧页退场。
 *
 * 只做三件事：退焦、上浮、淡出。全程朝同一个方向（往上），没有任何遮罩从
 * 外面盖进来——那类做法在浅色界面上都会被读成别的介质。
 *
 * 淡出压在后半段：前半段先把旧页糊掉，眼睛就看不到两套排版同时在读；等它
 * 散成一片色，再交出不透明度，接缝就藏起来了。
 */
function fadeGhost(ghost: HTMLElement, duration: number, lift: number) {
  const started = performance.now()
  let frame = 0
  let done = false

  const settle = () => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    ghost.style.display = 'none'
    ghost.style.opacity = '1'
    ghost.style.transform = ''
    ghost.style.filter = ''
    ghost.style.willChange = ''
    ghost.replaceChildren()
  }

  ghost.style.willChange = 'opacity, transform, filter'

  const paint = () => {
    const t = clamp01((performance.now() - started) / duration)
    const p = easeOut(t)
    /*
     * 不透明度按线性时间走，而且只占前三分之一。
     *
     * 用缓动后的 p 去算淡出，开局慢、末尾拖，旧页会在屏幕上赖到两百多毫秒，
     * 和新页叠成「两套排版同时在读」。这里让它在一百六十毫秒内就交出去，剩下
     * 的时间画面只属于新页。
     */
    const fade = clamp01(t / 0.3)
    /*
     * 边淡边压暗。
     *
     * 只降 opacity 的话，旧页在淡出途中还是「可读的第二套排版」：列表每一行
     * 都清清楚楚地压在新页上面，两层字互相打架。把亮度一起拉下去，旧页就从
     * 「另一个页面」变成「一张正在退走的底图」，眼睛只读新页。
     */
    const dim = 1 - p * 0.55
    ghost.style.opacity = String(1 - fade)
    ghost.style.transform = 'translateY(' + (-p * lift).toFixed(2) + 'px)'
    ghost.style.filter =
      'blur(' + (p * 6).toFixed(2) + 'px) brightness(' + dim.toFixed(3) + ')'
    if (t < 1 && !done) frame = requestAnimationFrame(paint)
    else settle()
  }

  frame = requestAnimationFrame(paint)

  /* 兜底：窗口失焦、页面被藏起来时 rAF 会停，旧页会一直盖在新页上面。 */
  window.setTimeout(settle, duration + 240)
}

/**
 * 播一次换页。
 *
 * 调用点在 App 的 layout effect 里：此刻新页已经挂上、旧页节点已从文档摘除。
 */
export function retirePage(parts: PageParts, rect: DOMRect) {
  /*
   * 冷却：一次导航可能连着重建两次正文。
   *
   * 路由先落 view（key 里还没有 id），详情数据一到 key 才补齐，正文于是重建
   * 第二次。两场转场叠着跑，第二场会把第一场刚铺好的画面整个重刷一遍
   * （钻详情时就是它把封面飞行盖掉的）。上一场没走完就直接跳过。
   */
  const now = performance.now()
  if (now < cooldownUntil) return

  /*
   * 钻详情（封面正在飞）时退得更短、更轻：舞台要让给那一张图。
   * 旧页 260ms 化开，封面从旧页的卡片位置一路飞到新页头部，全程在最上层。
   */
  const flying = hasPendingCover()
  const duration = flying ? QUIET_DURATION : DURATION
  cooldownUntil = now + duration

  const scrollTop = parts.body.scrollTop
  const ghost = ensureGhost()
  ghost.dataset.mode = flying ? 'quiet' : 'page'
  mountGhost(ghost, parts, rect, scrollTop)

  fadeGhost(ghost, duration, flying ? 10 : 22)
  if (flying) flyToRemembered()
}