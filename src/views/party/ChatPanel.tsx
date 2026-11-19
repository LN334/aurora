import { useState } from 'react'
import { useParty } from '../../features/party/store'

/** 房间聊天：消息列表 + 输入 + 快捷表情。自带状态，不依赖房间面板。 */

const EMOJIS = ['👍', '🎵', '🔥', '😂', '❤️', '🎉', '👏', '😭']

function clock(at: number): string {
  const date = new Date(at)
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}

export function ChatPanel() {
  const state = useParty((store) => store.state)
  const [draft, setDraft] = useState('')

  const say = async (text: string): Promise<void> => {
    const body = text.trim()
    if (!body) return
    await useParty.getState().say(body)
    setDraft('')
  }

  return (
    <div className="party__chat">
      {state.messages.length === 0 ? (
        <p className="pg-note">房间里还没人说话</p>
      ) : (
        <ul className="party__messages">
          {state.messages.map((message) => (
            <li key={message.id} className={'party__message' + (message.host ? ' is-host' : '')}>
              <span className="party__message-name">{message.name}</span>
              <span className="party__message-text">{message.text}</span>
              <span className="party__message-at">{clock(message.at)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="party__say">
        <input
          className="input"
          placeholder={state.role === 'idle' ? '还没进房间' : '说点什么'}
          value={draft}
          maxLength={200}
          disabled={state.role === 'idle'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void say(draft)
            }
          }}
        />
        <button className="rh-btn" disabled={!draft.trim() || state.role === 'idle'} onClick={() => void say(draft)}>
          发送
        </button>
      </div>
      <div className="party__emojis">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            className="party__emoji"
            title={'发一个 ' + emoji}
            disabled={state.role === 'idle'}
            onClick={() => void say(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
