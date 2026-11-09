import { useEffect, useRef } from 'react'
import { displacementMap } from './displacement'

/*
 * 把液态玻璃挂到现有界面上。
 *
 * 这里不去改各个视图组件，而是集中维护一张选择器表：界面的「玻璃」是少数几个固定
 * 角色（播放条、抽屉、菜单、圆形浮动按钮），角色改了只动这张表，不必挨个组件加属性。
 * 副作用是这些元素必须在 CSS 里留好 --refract 的位置，见 glass.css 顶部说明。
 *
 * 尺寸变了要重算贴图（ResizeObserver），但拖窗口的那几十毫秒不算：html.is-resizing
 * 期间全站的 backdrop-filter 本来就被 !important 关掉（app.css 里有解释），这时候
 * 重建贴图纯属白烧 CPU。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

interface Target {
  selector: string
  /** 折射圈厚度，CSS px。窄元素会自动收窄（不超过高度的一半）。 */
  edge: number
  /** 位移强度。> 0.8 会开始糊，建议 0.45–0.65。 */
  strength: number
}

const TARGETS: Target[] = [
  // 播放条横贯全宽，边缘只在上下一线，圈要宽一点才看得出厚度
  { selector: '.player', edge: 26, strength: 0.9 },
  // 抽屉：四边都在视野里（左接内容、上下贴边），圈略窄，否则左右两侧像被压扁
  { selector: '.panel', edge: 22, strength: 0.55 },
  // 首页的薄玻璃卡片：底色只有 7% 白，背后壁纸全在，位移才看得见
  { selector: '.rh-sc', edge: 18, strength: 0.8 },
  { selector: '.rh-daily', edge: 22, strength: 0.7 },
  // 菜单小，圈只能给到 10 上下；再宽整块就变成一个水珠，文字也跟着晃
  { selector: '.menu', edge: 10, strength: 0.5 },
  { selector: '.lk-menu', edge: 10, strength: 0.5 },
  // 圆形浮动按钮：直径 40，圈 9 已经占掉近半，再大就整颗变成水珠
  { selector: '.tracks__tool', edge: 9, strength: 0.6 }
]

/*
 * 刻意没进表的：.nm（确认/命名弹窗）底色 0.96 近不透明，背后什么都看不见，折射
 * 白算一张贴图；首页几个 .rh-* 卡片是内容本身，弯折会让封面图边缘发虚。 */

interface Applied {
  filterId: string
  width: number
  height: number
}

function radiusOf(el: HTMLElement): number {
  const style = getComputedStyle(el)
  const parsed = parseFloat(style.borderTopLeftRadius)
  return Number.isFinite(parsed) ? parsed : 0
}

export function Refraction() {
  const defsRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const defs = defsRef.current
    if (!defs) return

    const applied = new Map<HTMLElement, Applied>()
    const pending = new Map<HTMLElement, number>()
    let seq = 0
    let disposed = false

    const drop = (el: HTMLElement) => {
      const record = applied.get(el)
      if (!record) return
      defs.querySelector(`#${record.filterId}`)?.remove()
      el.style.removeProperty('--refract')
      applied.delete(el)
    }

    const paint = (el: HTMLElement, target: Target) => {
      if (disposed || !el.isConnected) return
      // 元素刚插进 DOM 时还能是 0 宽（比如抽屉在 hidden 阶段），等下一轮再说
      const width = el.offsetWidth
      const height = el.offsetHeight
      if (width < 12 || height < 12) return

      const previous = applied.get(el)
      if (previous && previous.width === width && previous.height === height) return
      if (previous) drop(el)

      const map = displacementMap(width, height, radiusOf(el), target.edge, target.strength)
      if (!map) return

      const filterId = `refract-${(seq += 1)}`
      const filter = document.createElementNS(SVG_NS, 'filter')
      filter.setAttribute('id', filterId)
      // userSpaceOnUse + 元素本地坐标：原点贴着元素左上角，贴图才能和像素一一对上
      filter.setAttribute('filterUnits', 'userSpaceOnUse')
      filter.setAttribute('x', '0')
      filter.setAttribute('y', '0')
      filter.setAttribute('width', String(width))
      filter.setAttribute('height', String(height))
      filter.setAttribute('colorInterpolationFilters', 'sRGB')

      const image = document.createElementNS(SVG_NS, 'feImage')
      image.setAttribute('href', map.href)
      image.setAttribute('result', 'map')
      // 贴图是按这个尺寸生成的，别再让浏览器等比缩放
      image.setAttribute('preserveAspectRatio', 'none')
      image.setAttribute('x', '0')
      image.setAttribute('y', '0')
      image.setAttribute('width', String(width))
      image.setAttribute('height', String(height))

      const redirect = document.createElementNS(SVG_NS, 'feDisplacementMap')
      redirect.setAttribute('in', 'SourceGraphic')
      redirect.setAttribute('in2', 'map')
      redirect.setAttribute('xChannelSelector', 'R')
      redirect.setAttribute('yChannelSelector', 'G')
      redirect.setAttribute('scale', String(map.scale))

      filter.append(image, redirect)
      defs.append(filter)

      el.style.setProperty('--refract', `url(#${filterId})`)
      applied.set(el, { filterId, width, height })
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const target = TARGETS.find((item) => el.matches(item.selector))
        if (!target) continue
        // 拖窗口时跳过，松手后 resize 事件会补一次（见下面的 window 监听）
        if (document.documentElement.classList.contains('is-resizing')) continue
        const timer = pending.get(el)
        if (timer !== undefined) window.clearTimeout(timer)
        pending.set(
          el,
          window.setTimeout(() => {
            pending.delete(el)
            paint(el, target)
          }, 180)
        )
      }
    })

    const observed = new Set<HTMLElement>()

    const scan = () => {
      if (disposed) return
      for (const target of TARGETS) {
        document.querySelectorAll<HTMLElement>(target.selector).forEach((el) => {
          if (!observed.has(el)) {
            observed.add(el)
            observer.observe(el)
          }
          paint(el, target)
        })
      }
      // 关掉的抽屉/菜单会留在表里，清掉它们的 filter，别让 defs 无限长
      for (const el of applied.keys()) {
        if (!el.isConnected) {
          drop(el)
          observed.delete(el)
        }
      }
    }

    scan()

    // 菜单、抽屉、弹窗都是按需插进来的，DOM 一变就得重新认一遍
    let mutationTimer = 0
    const mutations = new MutationObserver(() => {
      if (mutationTimer) return
      mutationTimer = window.setTimeout(() => {
        mutationTimer = 0
        scan()
      }, 120)
    })
    mutations.observe(document.body, { childList: true, subtree: true })

    const onResize = () => scan()
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      mutations.disconnect()
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
      applied.forEach((_record, el) => {
        el.style.removeProperty('--refract')
      })
      applied.clear()
      defs.replaceChildren()
    }
  }, [])

  return (
    <svg
      ref={defsRef}
      aria-hidden="true"
      width="0"
      height="0"
      style={{ position: 'fixed', top: 0, left: 0, pointerEvents: 'none' }}
    />
  )
}
