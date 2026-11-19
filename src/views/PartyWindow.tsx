import { useEffect } from 'react'
import { PartyPanel } from './PartyPanel'
import { useParty } from '../features/party/store'

/**
 * 一起听的独立窗口。
 *
 * 房间是「一直开着看」的东西，和浏览/搜索不是一回事；塞在主界面里只能互相
 * 挡。这里复用同一份面板，只是把弹窗的定位让给它自己这一扇窗。
 */
export function PartyWindow() {
  useEffect(() => {
    document.body.classList.add('is-party-window')
    useParty.getState().init()
  }, [])

  return (
    <div className="party-window">
      <PartyPanel open onClose={() => window.close()} />
    </div>
  )
}
