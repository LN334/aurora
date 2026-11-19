import { useEffect } from 'react'
import { Close } from '../../ui/icons'
import { SakuraPanel } from './SakuraPanel'
import { useParty } from '../../features/party/store'

/** 樱花隧道窗口。 */
export function SakuraWindow() {
  useEffect(() => {
    document.body.classList.add('is-party-window')
    useParty.getState().init()
  }, [])

  return (
    <div className="party-window sakura-window">
      <aside className="party-dialog">
        <header className="panel__head">
          <h2 className="panel__title">樱花隧道</h2>
          <button className="icon-btn" onClick={() => window.close()} title="关闭" aria-label="关闭">
            <Close size={16} />
          </button>
        </header>
        <div className="panel__body">
          <SakuraPanel />
        </div>
      </aside>
    </div>
  )
}
