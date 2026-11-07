import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { useOnlineStore } from '../online/store'
import './KugouLogin.css'

/**
 * Kugou's sign-in dialog: a QR code, and nothing else.
 *
 * Same shape as QQ's dialog on purpose - the flow really is the same - but kept
 * as its own component because the two platforms answer differently: Kugou's
 * code lives five minutes and reports a distinct `scanned` state, so the poll
 * interval and the copy differ from QQ's. Sharing one component would mean
 * parameterising exactly those two things and nothing else, which is not worth
 * the indirection.
 *
 * Signing in is not optional here: anonymous stream requests are refused upstream
 * (code 20028), so this dialog is the difference between a browsable platform and
 * one that plays nothing.
 */

/** Which profile's dialog is open. Kept in a store so the account page can open it. */
export const useKugouLoginOpen = create<{ open: boolean; setOpen(open: boolean): void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))

type QrState =
  | { kind: 'loading' }
  | { kind: 'ready'; key: string; image: string }
  | { kind: 'scanned' }
  | { kind: 'failed'; message: string }

/** Kugou's own QR code is valid for five minutes; asking every two seconds is cheap. */
const POLL_MS = 2000

export function KugouLogin({ onClose }: { onClose(): void }) {
  const [qr, setQr] = useState<QrState>({ kind: 'loading' })
  /** Bumped to restart the loop when the code expires. */
  const [nonce, setNonce] = useState(0)

  const finish = useCallback(() => {
    /*
     * The session lives in the main process (safeStorage), so the renderer asks
     * again rather than trusting what the poll reported: the account row has to
     * show what the side that owns the cookie actually sees.
     */
    void useOnlineStore('kugou').getState().refreshAccount()
    onClose()
  }, [onClose])

  useEffect(() => {
    const bridge = window.aurora?.kugou
    if (!bridge) {
      setQr({ kind: 'failed', message: '浏览器预览模式没有主进程，无法显示二维码' })
      return
    }

    let alive = true
    let timer = 0
    setQr({ kind: 'loading' })

    const poll = async (key: string): Promise<void> => {
      const result = await bridge.qrCheck(key)
      if (!alive) return

      if (result.status === 'confirmed') {
        finish()
        return
      }
      if (result.status === 'expired' || result.status === 'failed') {
        setQr({ kind: 'failed', message: result.message ?? '二维码已过期' })
        return
      }
      if (result.status === 'scanned') setQr({ kind: 'scanned' })
      timer = window.setTimeout(() => void poll(key), POLL_MS)
    }

    void (async () => {
      try {
        const created = await bridge.qrCreate()
        if (!alive) return
        if (!created.imageDataUrl) {
          setQr({ kind: 'failed', message: '没有拿到二维码，请重试' })
          return
        }
        setQr({ kind: 'ready', key: created.key, image: created.imageDataUrl })
        timer = window.setTimeout(() => void poll(created.key), POLL_MS)
      } catch (error) {
        if (!alive) return
        setQr({ kind: 'failed', message: error instanceof Error ? error.message : '二维码创建失败' })
      }
    })()

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [finish, nonce])

  return (
    <div className="kugou-login" role="dialog" aria-modal="true" aria-label="登录酷狗音乐">
      <div className="kugou-login__panel">
        <header className="kugou-login__head">
          <h2 className="kugou-login__title">登录酷狗音乐</h2>
          <button className="kugou-login__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="kugou-login__body">
          <div className="kugou-login__code">
            {qr.kind === 'ready' ? (
              <img className="kugou-login__image" src={qr.image} alt="酷狗音乐登录二维码" />
            ) : (
              <div className="kugou-login__placeholder">
                {qr.kind === 'loading' ? '正在获取二维码…' : null}
                {qr.kind === 'scanned' ? '已扫码，请在手机上确认' : null}
                {qr.kind === 'failed' ? qr.message : null}
              </div>
            )}
          </div>

          <p className="kugou-login__hint">扫码登录酷狗音乐</p>

          {qr.kind === 'failed' ? (
            <button className="btn btn--small" onClick={() => setNonce((value) => value + 1)}>
              换一个二维码
            </button>
          ) : null}

          <p className="kugou-login__note">第三方接口 · 仅供自用</p>
        </div>
      </div>
    </div>
  )
}
