import { useEffect, useState } from 'react'
import { buildDisplacementMap } from './displacement'

/**
 * 液态玻璃的挂载层。
 *
 * 一张表驱动：哪几个元素要做、边带多宽。组件本体不加属性——用 CSS 的
 * `backdrop-filter: var(--refract, ) blur(...)` 接上，`--refract` 只由这里写。
 * 没有 JS（或这张表里没有它）时变量为空，那一整条就退化成纯模糊。
 *
 * 贴图按元素真实像素生成：卡片宽高会随窗口变，必须跟着重建，否则圆角被拉伸。
 */
const TARGETS = [
  { selector: '.rh-now', edge: 24, id: 'lg-now' },
  { selector: '.player', edge: 24, id: 'lg-player' }
] as const

interface GlassMap {
  id: string
  width: number
  height: number
  url: string
  scale: number
}

export function Refraction() {
  const [maps, setMaps] = useState<GlassMap[]>([])

  useEffect(() => {
    let frame = 0
    const sizes = new Map<string, string>()

    function rebuild() {
      const next: GlassMap[] = []
      for (const target of TARGETS) {
        const node = document.querySelector<HTMLElement>(target.selector)
        if (!node) continue

        const rect = node.getBoundingClientRect()
        if (rect.width < 8 || rect.height < 8) continue

        // 尺寸没变就不重算：一张 1100×180 的贴图要跑二十万像素。
        const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`
        if (sizes.get(target.id) === key) continue

        const radius = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0
        const map = buildDisplacementMap({
          width: rect.width,
          height: rect.height,
          radius,
          edge: target.edge
        })
        if (!map) continue

        sizes.set(target.id, key)
        node.style.setProperty('--refract', `url(#${target.id})`)
        next.push({
          id: target.id,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          url: map.url,
          scale: map.scale
        })
      }
      if (next.length) setMaps(next)
    }

    function schedule() {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        rebuild()
      })
    }

    schedule()

    const resize = new ResizeObserver(schedule)
    TARGETS.forEach((target) => {
      const node = document.querySelector<HTMLElement>(target.selector)
      if (node) resize.observe(node)
    })

    // 卡片是「有歌在播」才出现的，创建时不在 DOM 里，得等它挂上来。
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
