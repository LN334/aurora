import { useEffect, useRef, useState } from 'react'
import { useLeave } from '../ui/presence'

/**
 * 起个名字。
 *
 * 应用自己的弹窗，不是 window.prompt：原生对话框是系统画的黄框，跟这一身皮
 * 一点关系没有，而且它挡在 Electron 外面，Esc 与回车都得靠浏览器默认行为。
 * 这一版把三件事写死：打开即聚焦、回车确认、Esc 与点空白处取消。
 */
export function NameModal({
  title,
  label,
  placeholder,
  initial = '',
  confirmText = '确定',
  onCancel,
  onConfirm
}: {
  title: string
  label: string
  placeholder?: string
  initial?: string
  confirmText?: string
  onCancel(): void
  onConfirm(name: string): void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const clean = value.trim()
  /*
   * 取消也走退场：弹窗由父级条件渲染，这里若直接调 onCancel，父级下一帧就把它
   * 摘掉，缩放淡出根本没机会播。确认按钮不延迟——动作已定，就不该再等。
   */
  const { leaving, leave } = useLeave(180)
  const cancel = () => leave(onCancel)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        leave(onCancel)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel, leave])

  const submit = () => {
    if (!clean) return
    onConfirm(clean)
  }

  return (
    <>
      <div
        className={'nm__scrim' + (leaving ? ' is-closing' : '')}
        onPointerDown={cancel}
        role="presentation"
      />
      <div
        className={'nm' + (leaving ? ' is-closing' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="nm__title">{title}</h2>
        <label className="nm__label">
          <span>{label}</span>
          <input
            ref={inputRef}
            className="nm__input"
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />
        </label>
        <div className="nm__acts">
          <button className="rh-btn" type="button" onClick={cancel}>
            取消
          </button>
          <button
            className="rh-btn rh-btn--main"
            type="button"
            onClick={submit}
            disabled={!clean}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </>
  )
}
