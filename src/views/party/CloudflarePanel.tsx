import { useState } from 'react'
import { useParty } from '../../features/party/store'

/**
 * Cloudflare 快速隧道。
 *
 * 樱花免费节点对「直接用节点域名访问」回 503 / 501（域名没备案），一起听被挡在
 * 外面。cloudflared 的快速隧道不要账号、不要备案、不花钱，把房间端口挂到一个
 * 随机域名上，WebSocket 能穿过去（实测能收到房间自己的「房间码不对」回复）。
 *
 * 代价写在脸上：地址随进程变。要固定地址得做具名隧道，那是另一件事。
 */
export function CloudflarePanel() {
  const cf = useParty((store) => store.cloudflare)
  const state = useParty((store) => store.state)
  const [note, setNote] = useState('')
  const [showLog, setShowLog] = useState(false)

  const copy = async (): Promise<void> => {
    const ok = await window.aurora?.app?.copy(cf.address)
    setNote(ok ? '地址已复制' : cf.address)
  }

  /* 写进房间：房主不必再回房间页粘一遍，隧道通了就能发邀请。 */
  const useInRoom = async (): Promise<void> => {
    await useParty.getState().setPublic(cf.address)
    const now = useParty.getState().state.publicAddress
    setNote(now === cf.address ? '已写进房间的公网地址，回房间页就能复制邀请链接' : '')
  }

  return (
    <section className="cf-tunnel" aria-label="Cloudflare 隧道">
      <header className="cf-tunnel__head">
        <h2>Cloudflare 隧道</h2>
        <span className="cf-tunnel__hint">不用账号、不用备案；地址随进程变，重启就得重新发</span>
      </header>

      <div className="cf-tunnel__row">
        {/*
          启动中不要把那串 INF 英文日志甩到脸上：cloudflared 起来时每秒都在打，
          这一行会被刷成一行一闪而过的诊断信息。这里只说人话，原始日志留给
          「公网隧道」页右边的日志面板。
        */}
        <i className={'party__lamp' + (cf.address ? ' is-on' : cf.running ? ' is-busy' : '')} />
        <span className="cf-tunnel__addr">
          {cf.address || (cf.running ? '正在建立隧道…（通常 5–20 秒）' : '没在跑')}
        </span>
        <button
          className="rh-btn"
          type="button"
          disabled={cf.running}
          onClick={() => void useParty.getState().startCloudflare()}
        >
          启动
        </button>
        <button
          className="rh-btn"
          type="button"
          disabled={!cf.running}
          onClick={() => void useParty.getState().stopCloudflare()}
        >
          停止
        </button>
      </div>

      {cf.address ? (
        <div className="cf-tunnel__row">
          <button className="rh-btn" type="button" onClick={() => void copy()}>
            复制地址
          </button>
          <button className="rh-btn" type="button" onClick={() => void useInRoom()}>
            写进房间
          </button>
          <span className="cf-tunnel__hint">
            房间端口 {state.address.includes(':') ? state.address.slice(state.address.lastIndexOf(':') + 1) : '—'}
          </span>
        </div>
      ) : null}

      {note ? <p className="party-page__hint">{note}</p> : null}
      {cf.error ? <p className="party-page__hint">{cf.error}</p> : null}

      {/*
        cloudflared 的原始输出。正常时用不着，起不来时它是唯一线索——
        樱花那边右边有日志面板，这条也得能看，不然报错只剩一行概括。
      */}
      {cf.log.length ? (
        <div className="cf-tunnel__logwrap">
          <button className="rh-btn" type="button" onClick={() => setShowLog((open) => !open)}>
            {showLog ? '收起日志' : '查看日志'}
          </button>
          {showLog ? <pre className="cf-tunnel__log">{cf.log.slice(-40).join('\n')}</pre> : null}
        </div>
      ) : null}
    </section>
  )
}
