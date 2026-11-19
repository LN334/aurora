import { useCallback, useRef, useState } from 'react'
import { AudioDebug } from '../features/player/AudioDebug'
import { EQ_BANDS } from '../features/player/store'
import { decodePreset, encodePreset } from '../features/presets/codec'
import { isSameCurve } from '../features/presets/saved'
import type { SavedPreset } from '../features/presets/saved'
import { Close, Wave } from '../ui/icons'
import { usePresence } from '../ui/presence'

const MIN_DB = -12
const MAX_DB = 12

 interface EqPreset {
  name: string
  gains: number[]
}

/**
 * Presets are written against the band layout in `player/store.ts`
 * (32 64 125 250 500 1k 2k 4k 8k 16k). They are starting points, not claims
 * about correctness: an EQ curve depends entirely on the headphones or speakers
 * in front of you.
 */
 const EQ_PRESETS: EqPreset[] = [
  { name: '平直', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: '低频加强', gains: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
  { name: '人声', gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, 0] },
  { name: '器乐', gains: [4, 3, 1, 0, -1, -1, 0, 1, 2, 3] },
  { name: '降低齿音', gains: [0, 0, 0, 0, 0, -1, -2, -3, -2, 0] }
]

function formatFreq(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz)
}

interface BandProps {
  freq: number
  gain: number
  disabled: boolean
  onChange(gain: number): void
}

function Band({ freq, gain, disabled, onChange }: BandProps) {
  const trackRef = useRef<HTMLDivElement>(null)

  const fromClientY = useCallback(
    (clientY: number) => {
      const element = trackRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      if (rect.height <= 0) return
      const ratio = 1 - (clientY - rect.top) / rect.height
      const clamped = Math.min(1, Math.max(0, ratio))
      onChange(Math.round(MIN_DB + clamped * (MAX_DB - MIN_DB)))
    },
    [onChange]
  )

  const percent = ((gain - MIN_DB) / (MAX_DB - MIN_DB)) * 100
  const zero = ((0 - MIN_DB) / (MAX_DB - MIN_DB)) * 100
  // The fill grows out of the 0 dB line in both directions, the way a hardware
  // fader reads, rather than always filling from the bottom.
  const fillBottom = gain >= 0 ? zero : percent
  const fillHeight = Math.abs(percent - zero)

  return (
    <div className="band">
      <div
        className="band__track"
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${freq} 赫兹`}
        aria-valuemin={MIN_DB}
        aria-valuemax={MAX_DB}
        aria-valuenow={gain}
        aria-valuetext={`${gain > 0 ? '+' : ''}${gain} 分贝`}
        aria-disabled={disabled || undefined}
        onPointerDown={(event) => {
          /*
           * 关着的时候别让人拖：以前只挂了 aria-disabled，鼠标照样能改，改完不生效
           * ——看起来就是「开关按了没反应」。要看曲线可以，改它得先开开关。
           */
          if (disabled) return
          event.currentTarget.setPointerCapture(event.pointerId)
          fromClientY(event.clientY)
        }}
        onPointerMove={(event) => {
          if (disabled) return
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          fromClientY(event.clientY)
        }}
        onDoubleClick={() => {
          if (!disabled) onChange(0)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          const step = event.shiftKey ? 3 : 1
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            onChange(Math.min(MAX_DB, gain + step))
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            onChange(Math.max(MIN_DB, gain - step))
          } else if (event.key === 'Home') {
            event.preventDefault()
            onChange(MIN_DB)
          } else if (event.key === 'End') {
            event.preventDefault()
            onChange(MAX_DB)
          } else if (event.key === '0') {
            event.preventDefault()
            onChange(0)
          }
        }}
      >
        <div className="band__rail" />
        <div className="band__zero" />
        <div className="band__fill" style={{ bottom: `${fillBottom}%`, height: `${fillHeight}%` }} />
        <div className="band__knob" style={{ bottom: `${percent}%` }} />
      </div>
      <div className="band__value tnum">{gain > 0 ? `+${gain}` : gain}</div>
      <div className="band__freq">{formatFreq(freq)}</div>
    </div>
  )
}

interface EqPanelProps {
  open: boolean
  enabled: boolean
  gains: number[]
  /** 存在本机的预设，点一下切过去。 */
  saved: SavedPreset[]
  onToggle(enabled: boolean): void
  onGain(index: number, gain: number): void
  onPreset(gains: number[]): void
  /** 存当前曲线；返回自动起的名字，用来报一句。 */
  onSavePreset(): string
  onApplyPreset(preset: SavedPreset): void
  onRemovePreset(id: string): void
  onClose(): void
}

export function EqPanel({
  open,
  enabled,
  gains,
  saved,
  onToggle,
  onGain,
  onPreset,
  onSavePreset,
  onApplyPreset,
  onRemovePreset,
  onClose
}: EqPanelProps) {
  // 关闭时先留着，让面板把退场动画走完再真正卸载。
  const { mounted, closing } = usePresence(open, 320)
  const [note, setNote] = useState('')
  if (!mounted) return null

  const isFlat = gains.every((gain) => gain === 0)

  const flash = (text: string) => {
    setNote(text)
    window.setTimeout(() => setNote(''), 2200)
  }

  /**
   * 分享码就是这一条曲线本身。
   *
   * 只带 EQ（开关 + 十个增益）：面板里没有音质档与交叉淡化，把不存在于这个
   * 界面上的值塞进码里，恢复时会悄悄改掉别处的设置——那是最难查的一类意外。
   */
  const copyShareCode = async () => {
    const code = encodePreset({ name: '均衡曲线', eqEnabled: enabled, gains, crossfadeSec: 0 })
    try {
      await navigator.clipboard.writeText(code)
      flash('已复制分享码')
    } catch {
      flash('复制失败，剪贴板不可用')
    }
  }

  /**
   * 点预设就是「我要听这条曲线」：开关关着时顺手打开。
   *
   * 不这么做的话，点一下只改了数值、声音不变，用户只会觉得预设坏了。
   */
  const applyPreset = (gains: number[]) => {
    if (!enabled) onToggle(true)
    onPreset(gains)
  }

  const saveCurrent = () => {
    flash('已存为 ' + onSavePreset())
  }

  const pasteShareCode = async () => {
    try {
      const preset = decodePreset(await navigator.clipboard.readText())
      if (!preset) {
        flash('这串不是有效的声音预设')
        return
      }
      if (!enabled) onToggle(true)
      onPreset(preset.gains)
      flash('已应用：' + preset.name)
    } catch {
      flash('读不到剪贴板')
    }
  }

  return (
    <aside className={`panel${closing ? ' is-closing' : ''}`} aria-label="均衡器">
      <header className="panel__head">
        <h2 className="panel__title">均衡器</h2>
        <button
          className={`switch${enabled ? ' is-on' : ''}`}
          role="switch"
          aria-checked={enabled}
          onClick={() => onToggle(!enabled)}
          title={enabled ? '关闭均衡器' : '开启均衡器'}
        >
          <span className="switch__dot" />
        </button>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭均衡器">
          <Close size={16} />
        </button>
      </header>

      <div className="panel__presets">
        {EQ_PRESETS.map((preset) => {
          const active = preset.gains.every((gain, i) => gain === (gains[i] ?? 0))
          return (
            <button
              key={preset.name}
              className={`chip${active ? ' is-active' : ''}`}
              onClick={() => applyPreset(preset.gains)}
            >
              {preset.name}
            </button>
          )
        })}
        <button className="chip" onClick={saveCurrent} title="把当前曲线存成本机的一条预设">
          ＋ 存为预设
        </button>
      </div>

      {saved.length > 0 ? (
        <div className="panel__presets panel__presets--mine">
          <span className="panel__presets-label">我的</span>
          {saved.map((preset) => (
            <span
              key={preset.id}
              className={`chip chip--twin${isSameCurve(preset, gains, enabled) ? ' is-active' : ''}`}
            >
              <button className="chip__label" onClick={() => onApplyPreset(preset)}>
                {preset.name}
              </button>
              <button
                className="chip__x"
                title="删掉这条预设"
                aria-label={'删掉 ' + preset.name}
                onClick={() => onRemovePreset(preset.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="panel__bands">
        {EQ_BANDS.map((freq, index) => (
          <Band
            key={freq}
            freq={freq}
            gain={gains[index] ?? 0}
            disabled={!enabled}
            onChange={(gain) => onGain(index, gain)}
          />
        ))}
      </div>

      <AudioDebug />

      <footer className="panel__foot">
        <button className="rh-btn" onClick={() => applyPreset(EQ_BANDS.map(() => 0))} disabled={isFlat}>
          <Wave size={15} />
          重置为平直
        </button>
        <button className="rh-btn" onClick={() => void copyShareCode()} title="把当前曲线复制成一串码">
          复制分享码
        </button>
        <button className="rh-btn" onClick={() => void pasteShareCode()} title="从剪贴板还原一条曲线">
          粘贴还原
        </button>
        <p className="pg-note">{note || (enabled ? '拖动 · 双击归零' : '均衡器关着 · 打开右上角开关才生效')}</p>
      </footer>
    </aside>
  )
}
