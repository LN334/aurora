import { useEffect } from 'react'
import { useLeave } from '../ui/presence'

/**
 * 做一个不可撤销的动作之前先问一句。
 *
 * 与 NameModal 同一身皮（.nm 那一套），因为这两件事经常成对出现：改名要点确定，
 * 删单也要点确定。原生 window.confirm 是系统画的黄框，跟这个界面没有关系。
 */
export function ConfirmModal({
  title,
  body,
  confirmText = '确定',
  danger = false,
  onCancel,
  onConfirm
}: {
  title: string
  body?: string
  confirmText?: string
  danger?: boolean
  onCancel(): void
  onConfirm(): void
}) {
  // 与起名弹窗同一条规则：取消走退场，确认立刻生效。
  const { leaving, leave } = useLeave(180)
  const cancel = () => leave(onCancel)

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
        {body ? <p className="nm__note">{body}</p> : null}
        <div className="nm__acts">
          <button className="rh-btn" type="button" onClick={cancel}>
            取消
          </button>
          <button
            className={danger ? 'rh-btn rh-btn--danger' : 'rh-btn rh-btn--main'}
            type="button"
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </>
  )
}
