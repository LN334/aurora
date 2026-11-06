import { Rows } from '../parts'

/**
 * 04 快捷键。
 *
 * 只读清单，不做「可录制键位」：Aurora 的键位写死在 src/app/useKeyboardShortcuts.ts，
 * 做一份能改的映射就要连带处理冲突、持久化与「改完重载」三件事，收益远小于风险。
 * 但键位必须能查——参考项目（QueMusic 的快捷键页、Mineradio 的热键弹窗）都把它
 * 当一个正经分区摆在设置里，而不是藏在某个提示条里。
 *
 * 这一页的事实来源就是那个文件；加键位时一并改这里。
 */

interface KeyLine {
  keys: string[]
  what: string
}

interface KeyGroup {
  title: string
  lines: KeyLine[]
}

const GROUPS: KeyGroup[] = [
  {
    title: '任何页面',
    lines: [
      { keys: ['Ctrl', 'K'], what: '把光标放到顶部的搜索框；输完回车就进结果页' },
      { keys: ['Esc'], what: '先关掉最上层的面板（播放页、均衡器、队列），都关了再返回上一页' },
      { keys: ['Space'], what: '播放 / 暂停' },
      { keys: ['Ctrl', '→'], what: '下一首' },
      { keys: ['Ctrl', '←'], what: '上一首' },
      { keys: ['→'], what: '快进 5 秒（按住可以连走）' },
      { keys: ['←'], what: '快退 5 秒' },
      { keys: ['↑'], what: '音量加 5%' },
      { keys: ['↓'], what: '音量减 5%' }
    ]
  },
  {
    title: '面板',
    lines: [
      { keys: ['L'], what: '打开 / 收起播放页（沉浸歌词）' },
      { keys: ['E'], what: '打开 / 收起均衡器' }
    ]
  }
]

/** macOS 上修饰键是 ⌘，其余平台上写 Ctrl。 */
function modLabel(key: string): string {
  if (key !== 'Ctrl') return key
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform
  return /mac/i.test(platform) ? '⌘' : 'Ctrl'
}

/**
 * 一行：左边键帽、右边说明。
 *
 * 没有复用 Row：Row 的右侧留给控件，而这里右边就是文字本身，用 grid 排两列更直接。
 */
function KeyRow({ line }: { line: KeyLine }) {
  return (
    <div className="set-keyrow">
      <span className="set-keys">
        {line.keys.map((key, index) => (
          <span key={key + index}>
            {index > 0 ? <span className="set-keys__plus">+</span> : null}
            <kbd className="set-key">{modLabel(key)}</kbd>
          </span>
        ))}
      </span>
      <span className="set-keyrow__what">{line.what}</span>
    </div>
  )
}

export function HotkeysPane() {
  return (
    <Rows>
      {GROUPS.map((group) => (
        <div className="set-keygroup" key={group.title}>
          <h3 className="set-keygroup__title">{group.title}</h3>
          {group.lines.map((line) => (
            <KeyRow key={line.what} line={line} />
          ))}
        </div>
      ))}
      <p className="set-keyhint">
        光标在搜索框或任何一个输入框里时，上面这些键都不生效——打字不会顺带把歌切了。
      </p>
    </Rows>
  )
}
