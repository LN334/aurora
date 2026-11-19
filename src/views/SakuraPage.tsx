import { useEffect } from 'react'
import { SakuraPanel } from './party/SakuraPanel'
import { useParty } from '../features/party/store'

/** 樱花隧道：一页。与房间分开——房间管听什么，这里管怎么穿出去。 */
export function SakuraPage() {
  useEffect(() => {
    useParty.getState().init()
  }, [])

  return (
    <div className="party-page">
      <div className="party-page__grid">
        <section className="party-page__main">
          <SakuraPanel />
        </section>
        <aside className="party-page__side">
          <h2 className="party-page__h">它是干什么的</h2>
          <p className="party-page__hint">
            把房间开到公网，不在同一个 WiFi 也能进来。隧道是一条 TCP 通道：樱花服务端给你一个公网地址，转发到这台机器上的房间端口。
          </p>
          <h2 className="party-page__h">顺序</h2>
          <p className="party-page__hint">
            登录 → 建一条 TCP 隧道（本地地址填房间端口）→ 回到这里拉列表 → 点开关。
          </p>
        </aside>
      </div>
    </div>
  )
}
