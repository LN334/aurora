import { useEffect, useState } from 'react'
import { bridge } from '../../../bridge'
import { Actions, Note, Row, Rows, SettingsCard } from '../parts'
import { openPlatformLogin } from './PlatformSignIn'

/** 平台 id → 界面上叫的名字。 */
const NAMES: Record<string, string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  kugou: '酷狗音乐',
  qishui: '汽水音乐'
}

/** 状态 → 一句人话。正常时给「已连接」。 */
function stateLabel(state: string): string {
  if (state === 'ready') return '已连接'
  if (state === 'starting') return '正在连接'
  if (state === 'offline') return '网络不通'
  if (state === 'error') return '连接失败'
  return '还没启动'
}

/** 这几种状态可以点「重新连接」；已连接与正在连的时候按钮没有意义。 */
function canRetry(state: string): boolean {
  return state === 'error' || state === 'offline' || state === 'idle'
}

/**
 * 在线平台的后端状态。
 *
 * 四家的后端各自会失败：酷狗要 spawn 本地服务、网易云要完成设备握手、QQ 与汽水
 * 要读会话文件。失败的表现原来是「点歌没反应」，原因只在 startup.log 里——这个
 * 页面把状态摆出来，并且给一个当场重试的入口（重试与开屏预热走同一条路）。
 *
 * 状态由主进程推（platforms:changed），这里不轮询。
 */
export function PlatformsPane() {
  const [list, setList] = useState<Awaited<ReturnType<typeof bridge.platforms.status>>['list']>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    void bridge.platforms.status().then((payload) => {
      if (alive) setList(payload.list)
    })
    const off = bridge.platforms.onStatus((payload) => {
      if (!alive) return
      setList(payload.list)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const retry = async (id: string) => {
    setBusy(id)
    setNote('')
    const result = await bridge.platforms.retry(id)
    setBusy(null)
    if (!result.ok) setNote(result.reason ?? '重连没成功')
  }

  return (
    <>
      <SettingsCard
        title="平台连接"
        hint="四家各自起本地服务或读会话；连不上时先来这里看状态，不用翻日志。"
      >
        <Rows>
          {list.length === 0 ? (
            <Row label="还没读到状态" desc="主进程正在拉起平台适配层，过一会儿会自动刷新。">
              <span className="settings__number">—</span>
            </Row>
          ) : (
            list.map((item) => (
              <Row
                key={item.id}
                label={NAMES[item.id] ?? item.id}
                desc={
                  item.state === 'ready'
                    ? '已连上，可以搜索、播放与收藏。'
                    : item.state === 'starting'
                      ? '正在起本地服务或完成握手；第一次启动会慢一点。'
                      : item.state === 'error' || item.state === 'offline'
                        ? '连接失败了；点重新连接会走和冷启动同一条路。'
                        : '还没被用到；点歌、搜索或打开这一页都会触发启动。'
                }
                aside={
                  <span
                    className={
                      'settings__aside-state' +
                      (item.state === 'error' || item.state === 'offline' ? ' is-warn' : '')
                    }
                  >
                    {stateLabel(item.state)}
                  </span>
                }
                id={'platform-' + item.id}
              >
                <Actions>
                  {item.loggedIn === false ? (
                    <button className="btn" type="button" onClick={() => openPlatformLogin(item.id)}>
                      登录
                    </button>
                  ) : null}
                  {canRetry(item.state) ? (
                    <button
                      className="btn"
                      type="button"
                      disabled={busy === item.id}
                      onClick={() => void retry(item.id)}
                    >
                      {busy === item.id ? '正在重连' : '重新连接'}
                    </button>
                  ) : null}
                </Actions>
              </Row>
            ))
          )}
        </Rows>
      </SettingsCard>

      {note ? <Note tone="danger">上一次重连：{note}</Note> : null}
      <Note>
        登录状态由各平台会话文件决定；在这里点登录会打开应用的登录窗口，不会跳浏览器。
      </Note>
    </>
  )
}
