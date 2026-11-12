import { useEffect, useRef } from 'react'
import type { Palette } from '../features/library/palette'
import { useStageParticles } from '../features/settings/stage-particles'

/**
 * 舞台上的光尘。
 *
 * 之所以是 canvas 而不是一堆 CSS 元素：几十个绝对定位的 div 每次换封面都要重排，
 * 而这里每帧只是画两个圆，改密度也不用碰 DOM。颜色跟着封面走（palette），
 * 与整个界面的取色规则一致——舞台本身不发明颜色。
 *
 * 没开「减少动态效果」时才动：这类装饰是系统无障碍开关明确要关掉的东西。
 */

interface Mote {
  x: number
  y: number
  r: number
  drift: number
  rise: number
  alpha: number
  phase: number
  color: string
}

function makeMote(color: string): Mote {
  return {
    x: Math.random(),
    y: Math.random() * 1.1 - 0.05,
    r: 0.7 + Math.random() * 1.0,
    drift: 0.004 + Math.random() * 0.012,
    rise: 0.006 + Math.random() * 0.022,
    alpha: 0.22 + Math.random() * 0.3, // 0.1–0.36 那档在深色壁纸上看不出来
    phase: Math.random() * Math.PI * 2,
    color
  }
}

export function StageParticles({ palette }: { palette: Palette }) {
  const prefs = useStageParticles()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /* 帧循环只在挂载时建立一次，配置从 ref 里读最新值，改滑块不用重启动画。 */
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const paletteRef = useRef(palette)
  paletteRef.current = palette

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let motes: Mote[] = []
    let raf = 0
    let last = performance.now()
    let elapsed = 0

    const targetCount = (): number => Math.round(24 + prefsRef.current.density * 90)

    const colors = (): string[] => {
      const list = paletteRef.current.colors.filter((c) => /^#[0-9a-f]{6}$/i.test(c))
      return list.length > 0 ? list : ['#8fa8c8']
    }

    /** 按当前数量补齐/裁掉尾部；已有粒子原地保留，改密度时不会整屏重来。 */
    const reconcile = (): void => {
      const want = targetCount()
      const pool = colors()
      while (motes.length < want) motes.push(makeMote(pool[motes.length % pool.length]))
      if (motes.length > want) motes.length = want
    }

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      motes = []
      reconcile()
    }

    const paint = (dt: number, advance: boolean): void => {
      const prefsNow = prefsRef.current
      const palette2 = paletteRef.current.colors
      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'
      const scale = width / 1512
      const radiusBase = (1.15 + prefsNow.size * 2.8) * Math.max(0.5, scale)
      const speed = 0.45 + prefsNow.speed * 2.2
      for (const mote of motes) {
        if (advance) {
          mote.y -= mote.rise * speed * dt
          mote.x += Math.sin(elapsed * 0.6 + mote.phase) * mote.drift * dt
          if (mote.y < -0.06) {
            mote.y = 1.06
            mote.x = Math.random()
            mote.color = palette2[Math.floor(Math.random() * Math.max(1, palette2.length))] ?? mote.color
          }
          if (mote.x < -0.04) mote.x = 1.04
          else if (mote.x > 1.04) mote.x = -0.04
        }
        const px = mote.x * width
        const py = mote.y * height
        const r = radiusBase * mote.r
        /* 亮度呼吸：静止的恒亮点像屏幕灰尘，一明一暗才像浮动的光。 */
        const breathe = 0.7 + 0.3 * Math.sin(elapsed * 0.9 + mote.phase * 1.7)
        ctx.globalAlpha = mote.alpha * breathe * 0.42
        ctx.fillStyle = mote.color
        ctx.beginPath()
        ctx.arc(px, py, r * 2.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = mote.alpha * breathe
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }

    const tick = (now: number): void => {
      raf = window.requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      elapsed += dt
      if (motes.length !== targetCount()) reconcile()
      paint(dt, true)
    }

    const start = (): void => {
      window.cancelAnimationFrame(raf)
      if (reduce.matches || !prefsRef.current.enabled) {
        paint(0, false)
        return
      }
      last = performance.now()
      raf = window.requestAnimationFrame(tick)
    }

    resize()
    start()

    const observer = new ResizeObserver(() => {
      resize()
      if (reduce.matches || !prefsRef.current.enabled) paint(0, false)
    })
    observer.observe(canvas)
    const onChange = (): void => start()
    reduce.addEventListener('change', onChange)

    return () => {
      observer.disconnect()
      reduce.removeEventListener('change', onChange)
      window.cancelAnimationFrame(raf)
    }
  }, [prefs.enabled])

  if (!prefs.enabled) return null

  return <canvas ref={canvasRef} className="stage__particles" aria-hidden="true" />
}