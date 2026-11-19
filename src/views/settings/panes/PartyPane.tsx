import { useState } from 'react'
import { Row, Rows } from '../parts'

/**
 * 一起听：房主侧那几项长期配置。
 *
 * 房间面板里也能改，但那是「这一趟开房」的上下文；把玩法和隧道参数摊在同一张
 * 设置页上，用户排查「为什么客人连不上」时才有地方对照。两处读写的是同一份
 * localStorage，不存在两份真相。
 */

const STORAGE = {
  port: 'aurora.party.port',
  frpc: 'aurora.party.frpc',
  token: 'aurora.party.token',
  tunnel: 'aurora.party.tunnel'
}

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
  const [port, setPort] = useStored(STORAGE.port)
  const [frpc, setFrpc] = useStored(STORAGE.frpc)
  const [token, setToken] = useStored(STORAGE.token)
  const [tunnel, setTunnel] = useStored(STORAGE.tunnel)

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
        label="樱花 frpc 路径"
        hint="面板「软件下载」里下载的独立版 frpc 的完整路径。启动器安装目录里那份不能被别的程序调用。"
        title={frpc || undefined}
      >
        <input
          className="settings__input settings__input--wide"
          value={frpc}
          placeholder="C:\...\frpc_windows_amd64.exe"
          onChange={(event) => setFrpc(event.target.value)}
        />
      </Row>

      <Row label="樱花访问密钥" hint="管理面板里的访问密钥；只存在这台机器上，用来起隧道。">
        <input
          className="settings__input settings__input--wide"
          value={token}
          placeholder="访问密钥"
          onChange={(event) => setToken(event.target.value)}
        />
      </Row>

      <Row label="樱花隧道 ID" hint="在建好的隧道详情里能看到；多个用逗号分隔。">
        <input
          className="settings__input"
          value={tunnel}
          placeholder="隧道 ID"
          onChange={(event) => setTunnel(event.target.value)}
        />
      </Row>
    </Rows>
  )
}
