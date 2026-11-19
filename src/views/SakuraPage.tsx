import { useEffect } from 'react'
import { SakuraPanel } from './party/SakuraPanel'
import { useParty } from '../features/party/store'

/** 樱花隧道：一页。与房间分开——房间管听什么，这里管怎么穿出去。 */
export function SakuraPage() {
  useEffect(() => {
    useParty.getState().init()
  }, [])

  return (
    <div className="party-page party-page--wide">
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
            ① 登录，密钥自己带回来，不用复制 ② 建一条 TCP 隧道，本地地址填房间端口 ③ 回到这里拉列表，点卡片上的开关。
          </p>
          <h2 className="party-page__h">frpc 用哪一份</h2>
          <p className="party-page__hint">
            官方独立发行的 frpc，在面板「软件下载」里下。启动器安装目录里那份只允许 SakuraFrp Service 调用，裸跑会直接退出。
          </p>
        </aside>
      </div>
    </div>
  )
}
