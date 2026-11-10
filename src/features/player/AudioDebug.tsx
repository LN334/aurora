import { useEffect, useRef } from 'react'
import { driver } from './driver'

/**
 * 实时电平与频谱，挂在均衡器抽屉里。
 *
 * 只画「声音现在长什么样」：频谱、时域波形、峰值 / RMS / 削波、输出采样率。
 * 各段增益故意不在这里再列一遍——推子就在上面，同一组数字画两次，改一处另一处
 * 还要跟着维护。
 *
 * 数字全部直写 DOM：每帧 setState 会让九个槽位那次的抖动重演一遍。
 */
export function AudioDebug() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const peakRef = useRef<HTMLSpanElement | null>(null)
  const rmsRef = useRef<HTMLSpanElement | null>(null)
  const clipRef = useRef<HTMLSpanElement | null>(null)
  const rateRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const paint = canvas?.getContext('2d') ?? null
    if (!canvas || !paint) return

    let raf = 0
    let clipUntil = 0
    let textAt = 0
    let infoAt = 0
    const accent = accentRgb()

    const tick = (now: number) => {
      raf = window.requestAnimationFrame(tick)
      const spectrum = driver.getSpectrum()
      const wave = driver.getWaveform()
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      paint.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint.clearRect(0, 0, width, height)

      if (!spectrum || !wave) {
        paint.fillStyle = 'rgba(255, 255, 255, 0.35)'
        paint.font = '12px system-ui, sans-serif'
        paint.fillText('还没有声音：先放一首', 12, height / 2)
        return
      }

      drawBars(paint, spectrum, width, height, accent)
      drawWave(paint, wave, width, height)
      drawGrid(paint, width, height)

      if (now - textAt < 100) return
      textAt = now
      const level = measure(wave)
      if (peakRef.current) peakRef.current.textContent = formatDb(toDb(level.peak))
      if (rmsRef.current) rmsRef.current.textContent = formatDb(toDb(level.rms))
      if (level.peak >= 0.99) clipUntil = now + 3000
      if (clipRef.current) clipRef.current.textContent = now < clipUntil ? '有' : '无'
      if (now - infoAt >= 900) {
        infoAt = now
        const info = driver.getAudioInfo()
        if (rateRef.current) {
          rateRef.current.textContent = info
            ? (info.sampleRate / 1000).toFixed(1) + ' kHz · ' + Math.round(info.baseLatency * 1000) + ' ms'
            : '还没有建好音频图'
        }
      }
    }

    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="adebug">
      <div className="adebug__head">
        <span className="adebug__title">实时电平</span>
        <span className="adebug__hint">调推子时看这里</span>
      </div>
      <canvas className="adebug__scope" ref={canvasRef} />
      <div className="adebug__meters">
        <span className="adebug__meter">
          <span className="adebug__k">峰值</span>
          <span className="adebug__v" ref={peakRef}>
            —
          </span>
        </span>
        <span className="adebug__meter">
          <span className="adebug__k">RMS</span>
          <span className="adebug__v" ref={rmsRef}>
            —
          </span>
        </span>
        <span className="adebug__meter">
          <span className="adebug__k">削波</span>
          <span className="adebug__v" ref={clipRef}>
            —
          </span>
        </span>
        <span className="adebug__meter">
          <span className="adebug__k">输出</span>
          <span className="adebug__v" ref={rateRef}>
            —
          </span>
        </span>
      </div>
    </div>
  )
}

/** 主色拆成 canvas 认得的 `r, g, b`；取不到就用一个中性蓝。 */
function accentRgb(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()
  if (!raw) return '150, 190, 255'
  return raw.split(/[ ,/]+/).filter(Boolean).join(', ')
}

function drawBars(
  paint: CanvasRenderingContext2D,
  spectrum: Uint8Array,
  width: number,
  height: number,
  accent: string
): void {
  const bars = 44
  const bins = spectrum.length
  const slot = width / bars
  for (let i = 0; i < bars; i += 1) {
    /*
     * 平方映射近似对数：线性分桶会把 20Hz 到 2kHz 全挤进左边十分之一，
     * 看上去永远是右边一条平线。
     */
    const from = Math.floor(Math.pow(i / bars, 2) * bins)
    const to = Math.max(from + 1, Math.floor(Math.pow((i + 1) / bars, 2) * bins))
    let top = 0
    for (let bin = from; bin < to; bin += 1) if (spectrum[bin] > top) top = spectrum[bin]
    const ratio = top / 255
    const barHeight = ratio * (height - 14)
    paint.fillStyle = 'rgba(' + accent + ', ' + (0.32 + ratio * 0.58).toFixed(2) + ')'
    paint.fillRect(i * slot + 1, height - barHeight, Math.max(1, slot - 2), barHeight)
  }
}

function drawWave(paint: CanvasRenderingContext2D, wave: Uint8Array, width: number, height: number): void {
  paint.strokeStyle = 'rgba(255, 255, 255, 0.5)'
  paint.lineWidth = 1
  paint.beginPath()
  for (let i = 0; i < wave.length; i += 1) {
    const x = (i / (wave.length - 1)) * width
    const y = (wave[i] / 255) * height
    if (i === 0) paint.moveTo(x, y)
    else paint.lineTo(x, y)
  }
  paint.stroke()
}

function drawGrid(paint: CanvasRenderingContext2D, width: number, height: number): void {
  paint.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  paint.lineWidth = 1
  paint.beginPath()
  paint.moveTo(0, height / 2)
  paint.lineTo(width, height / 2)
  paint.stroke()
}

function measure(wave: Uint8Array): { peak: number; rms: number } {
  let peak = 0
  let sum = 0
  for (const byte of wave) {
    const value = (byte - 128) / 128
    const magnitude = value < 0 ? -value : value
    if (magnitude > peak) peak = magnitude
    sum += value * value
  }
  return { peak, rms: Math.sqrt(sum / wave.length) }
}

function toDb(value: number): number {
  return value > 0.00001 ? 20 * Math.log10(value) : Number.NEGATIVE_INFINITY
}

function formatDb(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) + ' dB' : '静音'
}
