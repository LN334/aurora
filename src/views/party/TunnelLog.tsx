import { useEffect } from 'react'
import { useParty } from '../../features/party/store'
import { useDragScroll } from '../../ui/useDragScroll'

/**
 * 隧道日志。
 *
 * 照樱花启动器那扇日志窗来做：frpc 自己说的话比任何转述都准，出了问题该让人
 * 看见原文，而不是把一句「连接失败」反复说给用户听。等宽、折行、跟着最新一行
 * 滚到底；出错的行标成琥珀色。
 */
export function TunnelLog() {
  const tunnel = useParty((store) => store.tunnel)
  /* 没有滚动条，所以按住拖动也能滑。 */
  const { ref: box, handlers } = useDragScroll<HTMLDivElement>()

  useEffect(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [tunnel.log.length])

  return (
    <section className="sakura-log">
      <header className="sakura-log__head">
        <span className="sakura-log__title">日志</span>
        <i className={'party__lamp' + (tunnel.address ? ' is-on' : tunnel.running ? ' is-busy' : '')} />
        <span className="sakura-log__state">
          {tunnel.address ? '隧道已通 ' + tunnel.address : tunnel.running ? '正在连接' : '没有在跑'}
        </span>
        <button className="rh-btn" type="button" onClick={() => void useParty.getState().clearTunnelLog()}>
          清空
        </button>
      </header>
      <div className="sakura-log__body" ref={box} {...handlers}>
        {tunnel.log.length ? (
          tunnel.log.map((line, index) => (
            <div
              key={index}
              className={
                'sakura-log__line' +
                (/(error|failed|失败|错误|\[W\])/i.test(line) ? ' is-bad' : '') +
                (line.startsWith('——') ? ' is-mark' : '')
              }
            >
              {line}
            </div>
          ))
        ) : (
          <span className="sakura-log__empty">还没有日志。点左边卡片上的开关，这里会显示 frpc 的输出。</span>
        )}
      </div>
    </section>
  )
}
