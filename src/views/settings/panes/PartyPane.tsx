import { useState } from 'react'
import { Row, Rows } from '../parts'

/**
 * 一起听：房主侧那几项长期配置。
 *
 * 这里只留「程序自己决定不了」的两件事：房间端口固定成多少、frpc 是哪一份。
 * 访问密钥与隧道 ID 曾经也能在这里手填——那套做法已经被樱花隧道页取代（那把
 * 页自己拉列表、自己选隧道），同一个东西留两个入口只会让人怀疑哪个才算数。
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
  /* 只读展示：这一项由程序写入，人不该在这里手抄路径。 */
  const [frpc] = useStored('aurora.party.frpc')

  return (
    <Rows>
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
    </Rows>
  )
}
