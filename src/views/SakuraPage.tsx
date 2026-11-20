import { useEffect } from 'react'
import { CloudflarePanel } from './party/CloudflarePanel'
import { SakuraPanel } from './party/SakuraPanel'
import { TunnelLog } from './party/TunnelLog'
import { useParty } from '../features/party/store'

/**
 * 樱花隧道：一页。
 *
 * 左边是隧道本身（卡片 + 开关），右边是 frpc 的原始日志——出了问题就看这里，
 * 不用去樱花启动器里再翻一遍。
 */
export function SakuraPage() {
  useEffect(() => {
    useParty.getState().init()
  }, [])

  return (
    <div className="party-page party-page--wide">
      <div className="party-page__grid">
        <section className="party-page__main">
          {/* Cloudflare 排在上面：它不需要账号和备案，是更省事的那条路。 */}
          <CloudflarePanel />
          <SakuraPanel />
        </section>
        <aside className="party-page__side sakura-side">
          <TunnelLog />
        </aside>
      </div>
    </div>
  )
}
