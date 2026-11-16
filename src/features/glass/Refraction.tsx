import { useEffect, useState } from 'react'
import { buildDisplacementMap } from './displacement'

/**
 * 液态玻璃的挂载层。
 *
 * 一张表驱动：哪几类元素要做、边带多宽。组件本体不加属性——用 CSS 的
 * `backdrop-filter: var(--refract, ) blur(...)` 接上，`--refract` 只由这里写。
 * 没有 JS（或这张表里没有它）时变量为空，那一整条就退化成纯模糊。
 *
 * 贴图按元素真实像素生成：卡片宽高会随窗口变，必须跟着重建，否则圆角被拉伸。
 *
 * 同一个选择器可能命中多个元素（弹窗、右键菜单都是动态创建、同屏可能好几个），
 * 所以每个命中元素各拿一张贴图、各分一个 filter id。元素离开 DOM 后要把它的
 * 贴图与 filter 一起回收，否则右键菜单点一次就多一个 `<filter>`。
 */
/*
 * 只给「透得过背景」的整块做折射：首页正在播放条、底部播放条。
 *
 * 弹窗（`.panel`）与右键菜单（`.lk-menu`）的底色是 0.9 不透明的墨色 —— 折射
 * 被自己的底盖住了，肉眼看不出来，却照样要多跑一份贴图加一份 filter。同屏开
 * 两个菜单就多两份，这笔钱花得完全没有回报，所以它们不在这张表里。
 */
const TARGETS = [
  { selector: '.rh-now', edge: 24, prefix: 'lg-now' },
  { selector: '.player', edge: 24, prefix: 'lg-player' }
] as const

interface GlassMap {
  id: string
  width: number
  height: number
  url: string
  scale: number
}

/** 贴图缓存键：同一元素、同一尺寸复用上一次的结果。 */
function mapKey(id: string, width: number, height: number): string {
  return `${id}:${width}x${height}`
}

export function Refraction() {
  const [maps, setMaps] = useState<GlassMap[]>([])

  useEffect(() => {
    let frame = 0
    const cache = new Map<string, GlassMap>()
    const observed = new Set<HTMLElement>()

    function rebuild() {
      const next: GlassMap[] = []
      const live = new Set<string>()
      const seen = new Set<HTMLElement>()

      // 没开壁纸时玻璃后面是纯底色，折射什么都看不到：这一轮把图全卸掉。
      if (!document.querySelector('.wallpaper')) {
        cache.clear()
        for (const node of observed) {
          resize.unobserve(node)
          node.style.removeProperty('--refract')
        }
        observed.clear()
        setMaps([])
        return
      }

      for (const target of TARGETS) {
        const nodes = document.querySelectorAll<HTMLElement>(target.selector)
        let index = 0

        for (const node of nodes) {
          const rect = node.getBoundingClientRect()
          if (rect.width < 8 || rect.height < 8) continue
          // 滚出视口的不参与：列表里同时活着十几个元素时，只给看得见的付钱。
          if (
            rect.bottom <= 0 ||
            rect.top >= window.innerHeight ||
            rect.right <= 0 ||
            rect.left >= window.innerWidth
          ) {
            continue
          }

          const id = `${target.prefix}-${index}`
          index += 1
          seen.add(node)

          // 每轮都写：元素被复用时 id 会变，旧值不能留。
          node.style.setProperty('--refract', `url(#${id})`)

          const width = Math.round(rect.width)
          const height = Math.round(rect.height)
          const key = mapKey(id, width, height)
          live.add(id)

          const hit = cache.get(key)
          if (hit) {
            next.push(hit)
            continue
          }

          // 尺寸变了才重算：一张 1100×180 的贴图要跑二十万像素。
          const radius = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0
          const map = buildDisplacementMap({ width: rect.width, height: rect.height, radius, edge: target.edge })
          if (!map) continue

          const entry: GlassMap = { id, width, height, url: map.url, scale: map.scale }
          cache.set(key, entry)
          next.push(entry)
        }
      }

      // 回收：不在这一轮里的 id，连同它的贴图一起丢掉。
      for (const key of [...cache.keys()]) {
        const id = key.slice(0, key.lastIndexOf(':'))
        if (!live.has(id)) cache.delete(key)
      }

      // ResizeObserver 会持有元素引用，消失的要取消观察；顺手把变量摘掉，
      // 免得它继续指向一张已经被回收的 filter。
      for (const node of [...observed]) {
        if (seen.has(node)) continue
        observed.delete(node)
        resize.unobserve(node)
        node.style.removeProperty('--refract')
      }
      for (const node of seen) {
        if (observed.has(node)) continue
        observed.add(node)
        resize.observe(node)
      }

      setMaps(next)
    }

    function schedule() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        rebuild()
      })
    }

    const resize = new ResizeObserver(schedule)

    schedule()

    // 卡片是「有歌在播」才出现的，弹窗与菜单是点开才有的，创建时都不在 DOM 里。
    const mutation = new MutationObserver(schedule)
    mutation.observe(document.body, { childList: true, subtree: true })

    return () => {
      resize.disconnect()
      mutation.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <svg width={0} height={0} aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
      <defs>
        {maps.map((map) => (
          <filter
            key={map.id}
            id={map.id}
            filterUnits="userSpaceOnUse"
            x={0}
            y={0}
            width={map.width}
            height={map.height}
            colorInterpolationFilters="sRGB"
          >
            <feImage href={map.url} result="map" x={0} y={0} width={map.width} height={map.height} preserveAspectRatio="none" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="map"
              scale={map.scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        ))}
      </defs>
    </svg>
  )
}
