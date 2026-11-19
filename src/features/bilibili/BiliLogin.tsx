import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useOnlineStore } from '../online/store'
import './BiliLogin.css'

/**
 * B 站的扫码登录。
 *
 * 形状与另外三家相同（一个二维码、一段说明），扫的是哔哩哔哩 App。差别在意义：
 * 网易云、QQ、酷狗、汽水不登录就取不到歌单与推荐；B 站不登录也能搜能播，登录
 * 换来的是搜索不容易被人机验证挡下，以及更高档的音频轨。所以这里的文案写的是
 * 「登录可选」，不摆一副必须先过的门槛。
 */

/** 哪个档案的对话框是开着的。放在 store 里，账号页才能把它打开。 */
export const useBiliLoginOpen = create<{ open: boolean; setOpen(open: boolean): void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))

type QrState =
  | { kind: 'loading' }
  | { kind: 'ready'; key: string; image: string }
  | { kind: 'scanned' }
  | { kind: 'failed'; message: string }

const POLL_MS = 2000

export function BiliLogin({ onClose }: { onClose(): void }) {
  const [qr, setQr] = useState<QrState>({ kind: 'loading' })
  /** 换一个二维码时自增，让 effect 重跑。 */
  const [nonce, setNonce] = useState(0)

  /*
   * onClose 是调用点的内联箭头函数，父组件每渲染一次就换一个新引用。挂在 ref 上，
   * finish 才稳定：下面的 effect 依赖 finish，依赖不稳会在父组件每次更新时重跑，
   * 把用户可能已经在扫的二维码换掉。
   */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const finish = useCallback(() => {
    /*
     * 登录态在主进程（safeStorage），所以让渲染层重新问一次，而不是相信轮询的
     * 结论：账号卡片要显示的是真正持有凭据的那一侧看到的东西。
     */
    void useOnlineStore('bilibili').getState().refreshAccount()
    onCloseRef.current()
  }, [])

  useEffect(() => {
    const bridge = window.aurora?.bilibili
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
        const created = await bridge.loginQr()
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
    <div className="bili-login" role="dialog" aria-modal="true" aria-label="登录 B 站">
      <div className="bili-login__panel">
        <header className="bili-login__head">
          <h2 className="bili-login__title">登录 B 站</h2>
          <button className="bili-login__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        <div className="bili-login__body">
          <div className="bili-login__code">
            {qr.kind === 'ready' ? (
              <img className="bili-login__image" src={qr.image} alt="B 站登录二维码" />
            ) : (
              <div className="bili-login__placeholder">
                {qr.kind === 'loading' ? '正在获取二维码…' : null}
                {qr.kind === 'scanned' ? '已扫码，请在手机上确认' : null}
                {qr.kind === 'failed' ? qr.message : null}
              </div>
            )}
          </div>

          <p className="bili-login__hint">用哔哩哔哩 App 扫码</p>

          {qr.kind === 'failed' ? (
            <button className="btn btn--small" onClick={() => setNonce((value) => value + 1)}>
              换一个二维码
            </button>
          ) : null}

          <p className="bili-login__note">登录可选 · 不登录也能搜索与播放</p>
        </div>
      </div>
    </div>
  )
}
