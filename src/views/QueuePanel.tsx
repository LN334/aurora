import { useFavorites } from '../features/favorites/store'
import { usePlayer } from '../features/player/store'
import { formatTime } from '../ui/format'
import { ArtistName } from '../ui/NameRef'
import { Close, Compass, Heart, List, Next, Trash } from '../ui/icons'
import { usePresence } from '../ui/presence'

interface QueuePanelProps {
  open: boolean
  onClose(): void
  /** 空队列时给一条出路，而不是只说「队列是空的」。 */
  onOpenLibrary?: () => void
}

interface RowProps {
  trackIndex: number
  label: string
  isCurrent: boolean
  playing: boolean
  onJump(queueIndex: number): void
  onRemove(queueIndex: number): void
}

function QueueRow({ trackIndex, label, isCurrent, playing, onJump, onRemove }: RowProps) {
  const track = usePlayer((s) => s.queue[trackIndex] ?? null) // eslint-disable-line
  const liked = useFavorites((s) => (track ? s.liked.some((entry) => entry.id === track.id) : false))
  if (!track) return null

  return (
    <li className={`queue-row${isCurrent ? ' is-current' : ''}`}>
      <button
        className="queue-row__main"
        onClick={() => onJump(trackIndex)}
        title={isCurrent ? '正在播放' : `跳到 ${track.title}`}
      >
        <span className="queue-row__label">{label}</span>
        <span className="queue-row__title">
          {isCurrent && playing ? (
            <span className="eq is-live" aria-label="正在播放">
              <i />
              <i />
              <i />
            </span>
          ) : null}
          <span className="queue-row__title-text">{track.title || '（无标题）'}</span>
        </span>
        <span className="queue-row__artist"><ArtistName track={track} /></span>
        <span className="queue-row__time tnum">{formatTime(track.duration)}</span>
      </button>

      {/* 常驻的删除键会让整列看起来像「一排垃圾桶」；悬停才出，和六个参考
          播放器一致。正在播放的那首不给删除键——删掉它就等于切歌。 */}
      <div className="queue-row__ops">
        <button
          className={`queue-row__op${liked ? ' is-on' : ''}`}
          onClick={() => useFavorites.getState().toggle(track)}
          title={liked ? '取消喜欢' : '喜欢'}
          aria-label={liked ? `取消喜欢 ${track.title}` : `喜欢 ${track.title}`}
        >
          <Heart size={13} />
        </button>
        {isCurrent ? null : (
          <>
            <button
              className="queue-row__op"
              onClick={() => {
                const state = usePlayer.getState()
                const at = state.queue.findIndex((item) => item.id === track.id)
                if (at >= 0 && at !== state.index) state.removeAt(at)
                usePlayer.getState().enqueue([track], 'next')
              }}
              title="设为下一首"
              aria-label={`把 ${track.title} 设为下一首`}
            >
              <Next size={13} />
            </button>
            <button
              className="queue-row__op"
              onClick={() => onRemove(trackIndex)}
              title="从队列移除"
              aria-label={`从队列移除 ${track.title}`}
            >
              <Trash size={13} />
            </button>
          </>
        )}
      </div>
    </li>
  )
}

/**
 * The play queue.
 *
 * Rows are rendered in *play order*, not queue order, so the list shows what
 * will actually happen next - including the shuffle permutation. Rendering the
 * raw queue while shuffle is on would show an order that never plays.
 *
 * The two header actions are the ones every reference player has and this panel
 * was missing: jump back to whatever is playing, and drop the rest of the queue
 * without stopping the song.
 */
export function QueuePanel({ open, onClose, onOpenLibrary }: QueuePanelProps) {
  const queueLength = usePlayer((s) => s.queue.length)
  const order = usePlayer((s) => s.order)
  const index = usePlayer((s) => s.index)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const playing = usePlayer((s) => s.playing)
  // 关闭时先留着，让抽屉滑出去再卸载。
  const { mounted, closing } = usePresence(open, 320)

  if (!mounted) return null

  const at = order.indexOf(index)
  const upcoming = at === -1 ? [] : order.slice(at + 1)
  const played = at === -1 ? [] : order.slice(0, at)

  const jump = (queueIndex: number) => {
    usePlayer.getState().jumpTo(queueIndex)
  }

  const remove = (queueIndex: number) => {
    usePlayer.getState().removeAt(queueIndex)
  }

  const locate = () => {
    document
      .querySelector('.queue-row.is-current')
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <aside className={`panel${closing ? ' is-closing' : ''}`} aria-label="播放队列">
      <header className="panel__head">
        <h2 className="panel__title">播放队列</h2>
        <span className="panel__count tnum">
          {queueLength} 首
          {shuffle ? '，随机顺序' : ''}
          {repeat === 'one' ? '，单曲循环' : repeat === 'all' ? '，列表循环' : ''}
        </span>
        <div className="queue-actions">
          <button
            className="icon-btn"
            onClick={locate}
            title="定位到正在播放"
            data-tip="定位"
            aria-label="定位到正在播放"
            disabled={at < 0}
          >
            <Compass size={15} />
          </button>
          <button
            className="icon-btn"
            onClick={() => usePlayer.getState().clearUpcoming()}
            title="清空待播（当前这首继续放）"
            data-tip="清空待播"
            aria-label="清空待播"
            disabled={upcoming.length === 0}
          >
            <Trash size={15} />
          </button>
          <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭播放队列">
            <Close size={16} />
          </button>
        </div>
      </header>

      <div className="panel__scroll">
        {queueLength === 0 ? (
          <div className="tracks__empty">
            <List size={18} />
            队列是空的
            {onOpenLibrary ? (
              <button className="btn btn--small" onClick={onOpenLibrary}>
                去音乐库
              </button>
            ) : null}
          </div>
        ) : (
          <>
            {at >= 0 ? (
              <section className="queue-group">
                <h3 className="queue-group__title">正在播放</h3>
                <ul className="queue-list">
                  <QueueRow
                    trackIndex={index}
                    label=""
                    isCurrent
                    playing={playing}
                    onJump={jump}
                    onRemove={remove}
                  />
                </ul>
              </section>
            ) : null}

            <section className="queue-group">
              <h3 className="queue-group__title">
                接下来
                <span className="queue-group__count tnum">{upcoming.length}</span>
              </h3>
              {upcoming.length === 0 ? (
                <p className="queue-group__empty">队列里没有别的曲目了</p>
              ) : (
                <ul className="queue-list">
                  {upcoming.map((queueIndex, position) => (
                    <QueueRow
                      // 用队列下标当身份，不用「第几行」：切歌时整个待播列表
                      // 会往上挪一位，按位置当 key 会让每一行都被卸载重建，
                      // 面板看起来就在抽搐。
                      key={queueIndex}
                      trackIndex={queueIndex}
                      label={String(position + 1)}
                      isCurrent={false}
                      playing={playing}
                      onJump={jump}
                      onRemove={remove}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* Native disclosure: the played list is reference material, so it
                costs no state and starts folded. */}
            {played.length > 0 ? (
              <details className="queue-played">
                <summary className="queue-group__title">
                  已播放
                  <span className="queue-group__count tnum">{played.length}</span>
                </summary>
                <ul className="queue-list">
                  {played.map((queueIndex) => (
                    <QueueRow
                      key={queueIndex}
                      trackIndex={queueIndex}
                      label="·"
                      isCurrent={false}
                      playing={false}
                      onJump={jump}
                      onRemove={remove}
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
