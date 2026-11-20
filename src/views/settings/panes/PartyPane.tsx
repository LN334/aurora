import { useState } from 'react'
import { Row, Rows, Toggle } from '../parts'

/**
 * 一起听：房主侧那几项配置。
 *
 * 这里只放「程序自己决定不了」的东西：房间端口固定成多少、frpc 是哪一份；另外
 * 把两件容易找不到下落的事挂在眼前——密钥填过没有、当前选的是哪条隧道。它们
 * 的编辑入口只有一个（樱花隧道页），这里只显示状态加一个跳过去的按钮：同一个
 * 东西留两个输入框，用户永远会怀疑哪个才算数。
 */

function useStored(key: string): [string, (next: string) => void] {
  const [value, setValue] = useState(() => localStorage.getItem(key) ?? '')
  const write = (next: string): void => {
    setValue(next)
    if (next.trim()) localStorage.setItem(key, next.trim())
    else localStorage.removeItem(key)
  }
  return [value, write]
}

export function PartyPane() {
  const [port, setPort] = useStored('aurora.party.port')
  /* 下面三项都由樱花隧道页写，这里只读。 */
  const [frpc] = useStored('aurora.party.frpc')
  const [token] = useStored('aurora.party.token')
  const [tunnelId] = useStored('aurora.party.tunnel')
  /* 这两项进房间时才用到：名字显示给房里的人看，转发决定客人能不能只听房主的流。 */
  const [name, setName] = useStored('aurora.party.name')
  const [relay, setRelay] = useStored('aurora.party.relay')

  const openTunnels = (): void => {
    window.location.hash = '#sakura'
  }

  return (
    <Rows>
      <Row label="我的名字" hint="房间里别人看到的名字。留空就按身份显示「房主」或「听众」。">
        <input
          className="settings__input"
          value={name}
          maxLength={16}
          placeholder="留空就按身份"
          onChange={(event) => setName(event.target.value.slice(0, 16))}
        />
      </Row>

      <Row
        label="替房间转发音频"
        hint="开着时，客人不用登录也能听到你这一档音质；关着时各听各的。进房间后也能随时改。"
      >
        <Toggle checked={relay !== '0'} label="默认替房间转发音频" onChange={(next) => setRelay(next ? '1' : '0')} />
      </Row>

      <Row
        label="房间端口"
        hint="固定之后，樱花隧道里那个「本地端口」只要配一次。留空则每次开房随机挑一个。"
        title="被占用时会自动退回随机端口"
      >
        <input
          className="settings__input"
          value={port}
          inputMode="numeric"
          placeholder="留空则随机"
          onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
        />
      </Row>

      <Row
        label="樱花 frpc"
        hint="程序会自己找；找不到就去樱花隧道页点「装 frpc」，一份就够。这里只是让你看得出它用的是哪一份。"
        title={frpc || undefined}
      >
        <input className="settings__input settings__input--wide" value={frpc} readOnly placeholder="还没找到" />
      </Row>

      <Row label="访问密钥" hint="填一次就记在本机。要换一把，去樱花隧道页点「重新填写」。">
        <span className="set-count">{token ? '已配置' : '还没填'}</span>
        <button className="rh-btn" type="button" onClick={openTunnels}>
          去樱花隧道页
        </button>
      </Row>

      <Row label="当前隧道" hint="上一次在卡片上点开的那条；隧道里的本地端口会自动对齐房间。">
        <span className="set-count">{tunnelId ? '#' + tunnelId : '还没选'}</span>
        <button className="rh-btn" type="button" onClick={openTunnels}>
          挑一条
        </button>
      </Row>
    </Rows>
  )
}
