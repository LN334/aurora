/*
 * 启动兜底。
 *
 * 这个应用没有服务端，渲染期一抛错就是一片纯白窗口——用户能做的只有杀进程；
 * 而杀完再开，同一份 localStorage 还在，于是再白一次。这层边界不是「把错误吞
 * 掉」，是把错误换成一句人话加两个出口：重试，或者只丢界面状态（歌单、账号、
 * 播放记录一个不动）再开。
 *
 * 为什么需要它：实测过一次白屏，原因在缓存里的旧数据让某处 hook 数量变了，
 * 生产构建下 React 直接抛 #310、整棵树不挂载。清掉界面状态即恢复。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

/*
 * 白名单：这几个前缀下是用户自己攒下的东西，重置界面缓存时一个都不碰。
 * 反过来写（列出要删的键）不行——真正有毒的往往是没想到的那个键。
 */
const KEEPS = [
  'aurora.playlists',
  'aurora.presets',
  'aurora.likes',
  'aurora.accounts',
  'aurora.sourceOrder',
  'aurora.player.prefs',
  'aurora.search.',
  'aurora.motion',
  'aurora.theme',
  'aurora.lyric',
  'aurora.rowDensity',
  'aurora.lyricSize'
]

function clearInterfaceState(): void {
  const doomed: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith('aurora.')) continue
    if (KEEPS.some((prefix) => key.startsWith(prefix))) continue
    doomed.push(key)
  }
  for (const key of doomed) localStorage.removeItem(key)
  window.location.reload()
}

type Props = { children: ReactNode }
type State = { error: Error | null }

export class BootBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /* 主进程会把 console 转发进 startup.log，这行是事后唯一的现场。 */
    console.error('[boot] render failed', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="boot-fail">
        <p className="boot-fail__k">STARTUP FAILED</p>
        <h1 className="boot-fail__t">界面没能启动</h1>
        <p className="boot-fail__d">
          多半是缓存里的旧设置和新版本对不上。先试「重试」；还不行就点「重置界面状态」——
          歌单、账号和播放记录都不会动。
        </p>
        <div className="boot-fail__acts">
          <button type="button" className="rh-btn boot-fail__go" onClick={() => window.location.reload()}>
            重试
          </button>
          <button type="button" className="rh-btn" onClick={clearInterfaceState}>
            重置界面状态
          </button>
        </div>
        <p className="boot-fail__msg">{error.message}</p>
      </div>
    )
  }
}
