import { useCallback, useEffect, useState } from 'react'
import { create } from 'zustand'
import { useOnlineStore } from '../online/store'
import './QishuiLogin.css'

/**
 * 汽水音乐的登录对话框：一个二维码，就这些。
 *
 * 形状与 QQ / 酷狗那两个相同（流程确实一样），但轮询节奏按上游来：汽水的二维码
 * 也是五分钟过期，两秒一次很便宜。文案不同——扫的是抖音。
 *
 * 登录在这里不是可选项里的装饰：未登录时歌单接口直接答 auth-required，高音质
 * 也取不到，所以这个对话框决定了「能搜能播」和一个完整个平台之间的差别。
 */

/** 哪个档案的对话框是开着的。放在 store 里，账号页才能把它打开。 */
export const useQishuiLoginOpen = create<{ open: boolean; setOpen(open: boolean): void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))

type QrState =
  | { kind: 'loading' }
  | { kind: 'ready'; key: string; image: string }
  | { kind: 'scanned' }
  | { kind: 'failed'; message: string }

const POLL_MS = 2000

export function QishuiLogin({ onClose }: { onClose(): void }) {
  const [qr, setQr] = useState<QrState>({ kind: 'loading' })
  /** 换一个二维码时自增，让 effect 重跑。 */
  const [nonce, setNonce] = useState(0)

  const finish = useCallback(() => {
    /*
     * 会话在主进程（safeStorage + 设备 id），所以这里让渲染层重新问一次，
     * 而不是相信轮询的结论：账号那一行要显示的是真正持有凭据的那一侧看到的东西。
     */
    void useOnlineStore('qishui').getState().refreshAccount()
    onClose()
  }, [onClose])

  useEffect(() => {
    const bridge = window.aurora?.qishui
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
    <div className="qishui-login" role="dialog" aria-modal="true" aria-label="登录汽水音乐">
      <div className="qishui-login__panel">
        <header className="qishui-login__head">
          <h2 className="qishui-login__title">登录汽水音乐</h2>
          <button className="qishui-login__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="qishui-login__body">
          <div className="qishui-login__code">
            {qr.kind === 'ready' ? (
              <img className="qishui-login__image" src={qr.image} alt="汽水音乐登录二维码" />
            ) : (
              <div className="qishui-login__placeholder">
                {qr.kind === 'loading' ? '正在获取二维码…' : null}
                {qr.kind === 'scanned' ? '已扫码，请在手机上确认' : null}
                {qr.kind === 'failed' ? qr.message : null}
              </div>
            )}
          </div>

          <p className="qishui-login__hint">扫码登录汽水音乐</p>

          {qr.kind === 'failed' ? (
            <button className="btn btn--small" onClick={() => setNonce((value) => value + 1)}>
              换一个二维码
            </button>
          ) : null}

          <p className="qishui-login__note">第三方接口 · 仅供自用</p>
        </div>
      </div>
    </div>
  )
}
