/**
 * 封面飞行：列表里被点的那张图，先落到详情页的大封面上，再交回给页面。
 *
 * 为什么要单独做一层：整页 View Transition 在这条链上被证明不可用（首页与详情
 * 页 scrollTop 不同，整页快照会把两页错开，src/App.tsx 里记着这段），所以
 * .dp__art 上那个 view-transition-name 一直挂着、却从来没真正插值过。
 * 这里只飞一个元素：源矩形与目标矩形都由 DOM 量出来，中间只动 transform，
 * 不涉及任何快照，也就没有「两页对不齐」这回事。
 *
 * 数据走模块级变量而不是 sessionStorage：同一次导航里页面不刷新，模块变量足够，
 * 而且天然不会跨会话残留。只用 TTL 兜住「点了卡片却没进详情页」的情况。
 */

type CoverFlight = {
  sx: number
  sy: number
  sw: number
  sh: number
  url?: string
  bg: string
  at: number
}

const TTL_MS = 1600
/*
 * 飞行比换页退场（360ms）长一截：旧页化尽之后封面还在落位，收尾落在新页上。
 * 曲线用起步慢的那条，前面快的那版（0.22,1,0.36,1）在 20% 时间已走完九成，
 * 看起来像「封面凭空出现」而不是「飞过去」。
 */
const DURATION = 560

let pending: CoverFlight | null = null

/**
 * 有没有一张封面正等着飞。
 *
 * 换页那边用它决定要不要放帘幕：钻详情时舞台让给封面，帘幕会把它整个盖掉
 * （实测帘幕 900ms、飞行 460ms，飞行整段都在帘子后面）。
 */
export function hasPendingCover(): boolean {
  return pending !== null && performance.now() - pending.at < TTL_MS
}

function reducedMotion(): boolean {
  return (
    document.documentElement.classList.contains('is-reduced-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** 在导航之前调用：把被点那张卡上的封面量下来。 */
export function rememberCover(cover: HTMLElement | null | undefined): void {
  if (!cover) return
  const rect = cover.getBoundingClientRect()
  if (rect.width < 8 || rect.height < 8) return
  const img = cover.querySelector('img')
  const url = img instanceof HTMLImageElement ? img.currentSrc || img.src : undefined
  pending = {
    sx: rect.left,
    sy: rect.top,
    sw: rect.width,
    sh: rect.height,
    url: url || undefined,
    bg: getComputedStyle(cover).backgroundColor,
    at: performance.now()
  }
}

/**
 * 在详情页挂载后调用：把封面从源矩形飞到这块目标矩形上。
 *
 * 目标元素在飞行期间要藏起来（.is-flying 关掉它自己的入场动画），否则会同时
 * 看到两张封面。飞行是用 WAAPI 而不是 CSS 类：只有一次、且需要 finished 回调。
 */
/*
 * 落点登记。
 *
 * 起飞时机不能交给详情页的 effect：换页那边跑在 App 的 effect 里（父组件），
 * React 先跑子组件的 effect，飞行会抢在换页之前把 pending 消费掉，于是换页
 * 永远看不到「有一张封面在飞」，只会照常刷帘幕，把飞行盖住。
 *
 * 所以详情页只在挂载时把落点登记进来（ref 回调在 commit 阶段同步跑，早于任何
 * effect），真正起飞由 retirePage 决定。
 */
let targetEl: HTMLElement | null = null
let awaiting = false

/** 详情页挂载时登记封面落点。 */
export function coverTarget(el: HTMLElement | null): void {
  targetEl = el
  /* 换页先跑、落点后到（详情数据慢一拍）的那种情况，在这里补飞。 */
  if (el && awaiting && pending) {
    awaiting = false
    flyCoverTo(el)
  }
}

/** 换页那边调用：现在就把封面放出去飞。落点还没到时挂起，等 coverTarget 补。 */
export function flyToRemembered(): void {
  if (targetEl) {
    awaiting = false
    flyCoverTo(targetEl)
  } else {
    awaiting = true
  }
}

function flyCoverTo(target: HTMLElement | null): void {
  const from = pending
  pending = null
  if (!from || !target) return
  if (performance.now() - from.at > TTL_MS) return
  if (reducedMotion()) return

  const to = target.getBoundingClientRect()
  if (to.width < 8 || to.height < 8) return

  const layer = document.createElement('div')
  layer.className = 'cover-flight'
  layer.setAttribute('aria-hidden', 'true')
  layer.style.left = to.left + 'px'
  layer.style.top = to.top + 'px'
  layer.style.width = to.width + 'px'
  layer.style.height = to.height + 'px'
  layer.style.borderRadius = getComputedStyle(target).borderRadius

  const inner = document.createElement('div')
  inner.className = 'cover-flight__inner'
  inner.style.background = from.bg
  if (from.url) {
    const img = new Image()
    img.src = from.url
    img.alt = ''
    inner.appendChild(img)
  }
  layer.appendChild(inner)

  target.classList.add('is-flying')
  document.body.appendChild(layer)

  const scaleX = from.sw / to.width
  const scaleY = from.sh / to.height
  const dx = from.sx - to.left
  const dy = from.sy - to.top

  const animation = layer.animate(
    [
      { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + scaleX + ', ' + scaleY + ')' },
      { transform: 'translate(0px, 0px) scale(1, 1)' }
    ],
    {
      duration: DURATION,
      easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
      fill: 'both'
    }
  )

  const done = (): void => {
    target.classList.remove('is-flying')
    layer.remove()
  }
  animation.finished.then(done, done)
}
