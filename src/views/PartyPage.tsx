import { useEffect } from 'react'
import { PartyPanel } from './PartyPanel'
import { useParty } from '../features/party/store'

/**
 * 一起听：一页。
 *
 * 不是弹窗也不是窗口——房间的状态活在主进程里，这一页只是它的门面。离开这一页
 * 不等于退房，回来还在同一个房间里；真正的退房只有页面里那颗「离开房间」。
 */
export function PartyPage() {
  useEffect(() => {
    useParty.getState().init()
  }, [])

  return (
    <div className="party-page">
      <PartyPanel open onClose={() => undefined} />
    </div>
  )
}
