/**
 * 封面飞行：卡片上那张图飞到详情页的大封面上，标题跟着一起走。
 *
 * 背景：整页 View Transition 在这条链上不可用（首页与详情页 scrollTop 不同，整页
 * 快照会把两页错开，src/App.tsx 里记着这段），.dp__art 上那个
 * view-transition-name 于是从来没真正插值过。这里只飞一个元素：两端矩形都从 DOM
 * 量，中间只动 transform，不涉及快照，也就没有「两页对不齐」。
 *
 * 做法学 Folia 的 collectionMorph（src/library/suites/grid/transitions/morphFlight.ts），
 * 逐条对应：
 *   · 位移不是 cubic-bezier 而是一条阻尼弹簧（RESPONSE 0.36 / DAMPING 0.86，过冲
 *     不到百分之一）——起步立刻走、落位自己收住，没有「走到头再停」的那一下。
 *     弹簧写不成 CSS 缓动，采成 32 个关键帧；段落之间是直线，32 段看不出折线。
 *   · 载具按**落点**布局，飞完 transform 归零，下面的目标封面直接接手，没有缝。
 *   · 盒子只动 transform（合成器线程，目标页正在主线程挂载）；图片在盒子里再反向
 *     补一次，任何时刻都等价于 object-fit: cover，两端矩形比例不同也不变形。
 *   · 圆角单独一条动画：非等比缩放下圆会被画成椭圆，每个采样各自抵消自己的 scale。
 *   · 框的边只在空中亮，两端归零。
 *   · 落地后载具在目标上溶解 140ms，不是直接摘走。
 *
 * 三处没照抄（自己的判断）：
 *   · 不飞 shade 层——Aurora 的封面本来就是一「色块 + 图」，没有墙上那层压暗。
 *   · 不做散射——Folia 的墙在原地，卡片起飞时邻居要被推开；Aurora 换页时旧页整页
 *     消失，推开谁都没有第二帧去看见。
 *   · 不做回程——列表页重新挂载后滚动位置与卡片位置都可能变，飞回去会落在错的卡上。
 *     接口朝前用，等真要回程时再量。
 *   · 自加一道 accent 色光边：Folia 用白边，浅色主题下白边贴着白卡片看不出来；
 *     accent 是这张封面自己的颜色，飞起来像它自己在发光。
 */

type CoverRect = { x: number; y: number; width: number; height: number }

/** 标题的落点：文本矩形左上角，与字号。 */
type CoverTitle = { text: string; x: number; y: number; size: number }

type CoverFlight = {
  rect: CoverRect
  radius: number
  url?: string
  bg: string
  title: CoverTitle | null
  /** 封面的宽高比；两端矩形形状不同时靠它算 cover。 */
  proportions: number
  at: number
}

/** 在空中的时间。 */
const FLIGHT_MS = 460
/** 落地后载具化掉的时间。 */
const HANDOVER_MS = 140
/** 弹簧曲线的采样数，含两端。 */
const SAMPLES = 32
/** 弹簧的一个周期。 */
const RESPONSE = 0.46
/** 阻尼比：过冲不到百分之一。 */
const DAMPING = 0.86
/** 框的边在空中最亮时的强度。 */
const EDGE_PEAK = 0.9
/**
 * 飞行中途「拎起来」的放大倍数。
 *
 * Folia 的墙上是百来像素的小卡飞进大图，缩放本身就有戏。Aurora 的列表封面
 * 197px、详情封面 186px，两端几乎一样大——照抄就只有一段平移。这里让盒子在
 * 中途鼓到 1 + SWELL，两端回到 1，才有「被拎起来看一眼再放下」的意思。
 * 两轴同乘，等比，图片不会因此变形。
 */
const SWELL = 0.4

/**
 * 飞行途中向上拱起的高度（px）。
 *
 * 直线飞在两个位置很近的框之间看不出「飞」，只像一次瞬时挪位。让路径拱起来，
 * 盒子先被拎离桌面再落下——这是移形换影的「移形」那一半，纯 transform 另加。
 */
const ARC_LIFT = 46
/** 点了卡片却没进详情页时，这条记录最多留这么久。 */
const TTL_MS = 1600

let pending: CoverFlight | null = null

function reducedMotion(): boolean {
  return (
    document.documentElement.classList.contains('is-reduced-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** 从 0 松开、在 1 停住的弹簧；time 是 0 到 1 的时间比例。 */
function flightProgress(time: number): number {
  if (time <= 0) return 0
  if (time >= 1) return 1
  const seconds = time * (FLIGHT_MS / 1000)
  const natural = (2 * Math.PI) / RESPONSE
  const damped = natural * Math.sqrt(1 - DAMPING * DAMPING)
  const decay = Math.exp(-DAMPING * natural * seconds)
  return 1 - decay * (Math.cos(damped * seconds) + ((DAMPING * natural) / damped) * Math.sin(damped * seconds))
}

const between = (from: number, to: number, progress: number): number => from + (to - from) * progress
const round = (value: number): number => Number(value.toFixed(4))

/** 一张这个比例的图 cover 这个盒子时的尺寸。 */
function coverSize(box: { width: number; height: number }, proportions: number): { width: number; height: number } {
  const width = Math.max(box.width, box.height * proportions)
  return { width, height: width / proportions }
}

/** 每个采样上的时间、位置与盒子缩放。 */
function samplesOf(source: CoverRect, target: CoverRect) {
  return Array.from({ length: SAMPLES }, (_, sample) => {
    const offset = sample / (SAMPLES - 1)
    const progress = flightProgress(offset)
    const width = between(source.width, target.width, progress)
    const height = between(source.height, target.height, progress)
    return {
      offset,
      progress,
      width,
      height,
      x: between(source.x, target.x, progress) - target.x,
      y: between(source.y, target.y, progress) - target.y,
      scaleX: width / target.width,
      scaleY: height / target.height
    }
  })
}

/** 一段不透明度：从 0 升起、保持、再归零。 */
function flightSwell(peak: number, riseTo: number, fallFrom: number): Keyframe[] {
  const frames: Keyframe[] = [{ opacity: 0, offset: 0 }, { opacity: peak, offset: riseTo }]
  frames.push({ opacity: peak, offset: fallFrom }, { opacity: 0, offset: 1 })
  return frames
}

/** 文本自己的矩形（块级元素的盒子会撑满整行，不是文字宽）。 */
function textRect(el: HTMLElement): DOMRect | null {
  const range = document.createRange()
  range.selectNodeContents(el)
  const rect = range.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

const CARD = '.rh-card, .pl-card, .trk, .lk-card, .ol-alb, .ol-pl'
/**
 * 全局监听卡片点击，记下它的封面。
 *
 * 逐个 onClick 里调 rememberCover 会漏：本地歌单、收藏专辑、首页推荐这些入口
 * 都只调 onNavigate，拿不到 DOM。这里在捕获阶段拦一次，谁被点就记谁，
 * 之后真的导航了才起飞（pending 有 1.6s 的寿命，没导航自然失效）。
 */
let watchingClicks = false

export function watchCoverClicks(): void {
  if (watchingClicks) return
  watchingClicks = true
  document.addEventListener(
    'click',
    (event) => {
      const node = event.target
      if (!(node instanceof Element)) return
      const card = node.closest(CARD)
      if (!card) return
      rememberCover(card.querySelector<HTMLElement>(CARD_ART))
    },
    true
  )
}

const CARD_ART = '.rh-card__art, .pl-card__art, .trk__art, .lk-card__art, .ol-alb__art, .ol-pl__art'
const CARD_TITLE =
  '.rh-card__title, .pl-card__title, .trk__title, .lk-card__title, .ol-alb__title, .ol-pl__title'

/** 卡片上那个标题：起飞时要跟封面一起走。 */
function readCardTitle(cover: HTMLElement): CoverTitle | null {
  const card = cover.closest(CARD)
  if (!card) return null
  const el = card.querySelector<HTMLElement>(CARD_TITLE)
  if (!el) return null
  const text = el.textContent?.trim()
  if (!text) return null
  const box = el.getBoundingClientRect()
  const size = parseFloat(getComputedStyle(el).fontSize)
  if (!(size > 0) || box.width < 6) return null
  return { text, x: box.left, y: box.top, size }
}

/** 详情页的大标题：标题的落点。 */
function readHeroTitle(target: HTMLElement): { el: HTMLElement; at: CoverTitle } | null {
  const hero = target.closest('.dp') ?? document
  const el = hero.querySelector<HTMLElement>('.dp__t')
  if (!el) return null
  const text = el.textContent?.trim()
  const rect = textRect(el)
  const size = parseFloat(getComputedStyle(el).fontSize)
  if (!text || !rect || !(size > 0)) return null
  return { el, at: { text, x: rect.left, y: rect.top, size } }
}

/** 在导航之前调用：把被点那张卡上的封面与标题量下来。 */
export function rememberCover(cover: HTMLElement | null | undefined): void {
  if (!cover) return
  const rect = cover.getBoundingClientRect()
  if (rect.width < 8 || rect.height < 8) return
  const style = getComputedStyle(cover)
  const img = cover.querySelector('img')
  const url = img instanceof HTMLImageElement ? img.currentSrc || img.src : ''
  pending = {
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    radius: parseFloat(style.borderRadius) || 0,
    url: url || undefined,
    bg: style.backgroundColor,
    title: readCardTitle(cover),
    proportions: rect.width / rect.height,
    at: performance.now()
  }
}

/*
 * 落点登记。
 *
 * 起飞时机不能交给详情页的 effect：换页跑在 App 的 effect 里（父组件），React 先跑
 * 子组件的 effect，飞行会抢在换页之前把 pending 消费掉。所以详情页只在挂载时把落点
 * 登记进来——ref 回调在 commit 阶段同步跑，早于任何 effect。
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

  const box = target.getBoundingClientRect()
  if (box.width < 8 || box.height < 8) return

  const to: CoverRect = { x: box.left, y: box.top, width: box.width, height: box.height }
  const toRadius = parseFloat(getComputedStyle(target).borderRadius) || 0
  const hero = readHeroTitle(target)
  const shape = from.proportions > 0 && Number.isFinite(from.proportions) ? from.proportions : 1
  const home = coverSize(to, shape)
  const samples = samplesOf(from.rect, to)

  /* 外壳铺满视口、不带 transform；盒子与标题都是它的子元素。 */
  const root = document.createElement('div')
  root.className = 'cover-flight__root'
  root.setAttribute('aria-hidden', 'true')

  const frame = document.createElement('div')
  frame.className = 'cover-flight'
  frame.style.left = to.x + 'px'
  frame.style.top = to.y + 'px'
  frame.style.width = to.width + 'px'
  frame.style.height = to.height + 'px'

  const pic = document.createElement('div')
  pic.className = 'cover-flight__pic'
  pic.style.left = (to.width - home.width) / 2 + 'px'
  pic.style.top = (to.height - home.height) / 2 + 'px'
  pic.style.width = home.width + 'px'
  pic.style.height = home.height + 'px'
  pic.style.background = from.bg
  if (from.url) {
    const img = new Image()
    img.src = from.url
    img.alt = ''
    pic.appendChild(img)
  }

  const edge = document.createElement('div')
  edge.className = 'cover-flight__edge'

  frame.appendChild(pic)
  frame.appendChild(edge)
  root.appendChild(frame)

  /* 标题：只在两端都有标题时飞。 */
  let titleEl: HTMLElement | null = null
  let titleMove: Keyframe[] | null = null
  if (from.title && hero) {
    const a = from.title
    const b = hero.at
    titleEl = document.createElement('div')
    titleEl.className = 'cover-flight__title'
    titleEl.textContent = a.text
    titleEl.style.fontSize = a.size + 'px'
    titleEl.style.width = from.rect.width + 'px'
    titleEl.style.overflow = 'hidden'
    titleEl.style.textOverflow = 'ellipsis'
    root.appendChild(titleEl)
    titleMove = samples.map(({ offset, progress }) => ({
      offset,
      transform:
        'translate(' + round(between(a.x, b.x, progress)) + 'px, ' +
        round(between(a.y, b.y, progress)) + 'px) scale(' +
        round(between(a.size, b.size, progress) / a.size) + ')'
    }))
    /* 用 inline 而不是 class：class 去掉后 dp-rise 会从头重播，标题会先消失再淡入。 */
    hero.el.style.animation = 'none'
    hero.el.style.opacity = '0'
  }

  target.classList.add('is-flying')
  document.body.appendChild(root)

  const ease = { duration: FLIGHT_MS, fill: 'both' as FillMode }

  const boxFrames = samples.map(({ offset, x, y, scaleX, scaleY }) => {
    /*
     * 拱起与放大按**线性时间**走，不跟弹簧的 progress 走。
     * 弹簧在 300ms 就基本到位了，若用它，后半段整段静止，观感像「急刹车」。
     * 线性时间让隆起正好落在 230ms 的中点上，两端归零。
     */
    const t = Math.min(1, Math.max(0, offset))
    const swell = 1 + SWELL * Math.sin(Math.PI * t)
    const lift = Math.sin(Math.PI * t)
    return {
      offset,
      transform:
        'translate(' + round(x + lift * ARC_LIFT * 0.32) + 'px, ' + round(y - lift * ARC_LIFT) + 'px)' +
        ' scale(' + round(scaleX * swell) + ', ' + round(scaleY * swell) + ')'
    }
  })

  /* 圆角在非等比缩放下会被画成椭圆，每个采样各自抵消自己的 scale。 */
  const boxCorners = samples.map(({ offset, progress, scaleX, scaleY }) => {
    const radius = Math.max(0, between(from.radius, toRadius, progress))
    const swell = 1 + SWELL * Math.sin(Math.PI * Math.min(1, Math.max(0, offset)))
    return { offset, borderRadius: round(radius / (scaleX * swell)) + 'px / ' + round(radius / (scaleY * swell)) + 'px' }
  })

  /* 图片在盒子里反向补一次：任何时刻都等价于 object-fit: cover。 */
  const picFrames = samples.map(({ offset, width, height, scaleX, scaleY }) => {
    const cover = coverSize({ width, height }, shape).width / home.width
    const swell = 1 + SWELL * Math.sin(Math.PI * Math.min(1, Math.max(0, offset)))
    return { offset, transform: 'scale(' + round(cover / (scaleX * swell)) + ', ' + round(cover / (scaleY * swell)) + ')' }
  })

  const picCorners = boxCorners.map((k) => ({ offset: k.offset, borderRadius: k.borderRadius }))

  const flight = frame.animate(boxFrames, ease)
  frame.animate(boxCorners, ease)
  pic.animate(picFrames, ease)
  pic.animate(picCorners, ease)
  edge.animate(flightSwell(EDGE_PEAK, 0.16, 0.6), ease)
  if (titleEl && titleMove) titleEl.animate(titleMove, ease)

  const land = (): void => {
    /* 目标恢复显示的那一帧载具还盖在它上面，随后化掉，交接看不出断点。 */
    target.classList.remove('is-flying')
    if (hero) hero.el.style.opacity = '1'
    const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: HANDOVER_MS,
      easing: 'linear',
      fill: 'both'
    })
    fade.finished.then(() => root.remove(), () => root.remove())
  }

  flight.finished.then(land, land)
}
