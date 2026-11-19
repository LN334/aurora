import { useEffect } from 'react'
import { Close } from '../../ui/icons'
import { ChatPanel } from './ChatPanel'
import { useParty } from '../../features/party/store'

/** 聊天室窗口：只有消息与输入。 */
export function ChatWindow() {
  useEffect(() => {
    document.body.classList.add('is-party-window')
    useParty.getState().init()
  }, [])

  return (
    <div className="party-window chat-window">
      <aside className="party-dialog">
        <header className="panel__head">
          <h2 className="panel__title">聊天</h2>
          <button className="icon-btn" onClick={() => window.close()} title="关闭" aria-label="关闭聊天">
            <Close size={16} />
          </button>
        </header>
        <div className="panel__body">
          <ChatPanel />
        </div>
      </aside>
    </div>
  )
}
