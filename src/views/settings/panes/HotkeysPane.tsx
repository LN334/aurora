import { useEffect, useRef, useState } from 'react'
import { Rows } from '../parts'
import {
  HOTKEYS,
  HOTKEY_BY_ID,
  comboFor,
  comboOf,
  conflictFor,
  prettyCombo,
  useHotkeys
} from '../../../features/hotkeys/binding'

/**
 * 04 快捷键（可改）。
 *
 * 从前是一张只读清单：键位写死在 useKeyboardShortcuts 的一串 if 里。现在动作表
 * 在 features/hotkeys/binding.ts，这里只负责「显示当前是什么」与「按一下换成什么」。
 *
 * 录制时的两条规矩：
 * - 必须带修饰键，除非是 F1–F24 或方向键这类单键（否则打字全会误触发）；
 * - 同一个 scope 里已经有人占了这个组合就当场标红，不静默覆盖别人。
 */

/** 单独按这些键也可以绑：功能键与方向键不会和打字冲突。 */
function isBareOk(code: string): boolean {
  return /^F\d{1,2}$/.test(code) || code.startsWith('Arrow') || code === 'Space' || code === 'Escape'
}

function KeyChip({
  id,
  recording,
  onStart
}: {
  id: string
  recording: boolean
  onStart(): void
}) {
  if (recording) {
    return <span className="set-key is-recording">按任意键…</span>
  }
  const parts = prettyCombo(comboFor(id))
  if (parts.length === 1 && parts[0] === '未绑定') {
    return (
      <button type="button" className="set-key is-empty" onClick={onStart} title="点击绑定">
        未绑定
      </button>
    )
  }
  return (
    <button type="button" className="set-keys is-editable" onClick={onStart} title="点击修改">
      {parts.map((key, index) => (
        <span key={key + index}>
          {index > 0 ? <span className="set-keys__plus">+</span> : null}
          <kbd className="set-key">{key}</kbd>
        </span>
      ))}
    </button>
  )
}

export function HotkeysPane() {
  const overrides = useHotkeys((state) => state.overrides)
  const setBinding = useHotkeys((state) => state.set)
  const resetBinding = useHotkeys((state) => state.reset)
  const [recording, setRecording] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  /* 录制期间把按键从窗口层截下来：不然按 L 会顺手把播放页打开。 */
  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        setWarn(null)
        return
      }
      const combo = comboOf(event)
      const def = HOTKEY_BY_ID.get(recording)
      if (!def) return
      const hasMod = event.ctrlKey || event.metaKey || event.altKey
      if (!hasMod && !isBareOk(event.code)) {
        setWarn('单键只支持 F1–F24、方向键、空格与 Esc；其余请加 Ctrl 或 Alt。')
        return
      }
      const clash = conflictFor(def.scope, combo, def.id)
      if (clash) {
        setWarn('「' + prettyCombo(combo).join(' + ') + '」已经绑给了「' + clash.label + '」。')
        return
      }
      setBinding(def.id, combo)
      setRecording(null)
      setWarn(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, setBinding])

  /* 点到别处就取消录制。 */
  useEffect(() => {
    if (!recording) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (box.current && target && !box.current.contains(target)) {
        setRecording(null)
        setWarn(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [recording])

  const groups = [
    { title: '窗口内', scope: 'app' as const },
    { title: '任何程序里都能用（全局热键）', scope: 'global' as const }
  ]

  return (
    <Rows>
      <div ref={box}>
        {groups.map((group) => (
          <div className="set-keygroup" key={group.scope}>
            <h3 className="set-keygroup__title">{group.title}</h3>
            {HOTKEYS.filter((item) => item.scope === group.scope).map((item) => (
              <div className="set-keyrow" key={item.id}>
                <KeyChip
                  id={item.id}
                  recording={recording === item.id}
                  onStart={() => {
                    setRecording(item.id)
                    setWarn(null)
                  }}
                />
                <span className="set-keyrow__what">
                  {item.label}
                  {item.id in overrides ? (
                    <button
                      type="button"
                      className="set-keyrow__reset"
                      onClick={() => resetBinding(item.id)}
                      title={'恢复默认：' + prettyCombo(item.def).join(' + ')}
                    >
                      重置
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {warn ? <p className="set-keywarn">{warn}</p> : null}
      <div className="set-keys__foot">
        <button type="button" className="btn" onClick={() => useHotkeys.getState().resetAll()}>
          全部恢复默认
        </button>
      </div>
      <p className="set-keyhint">
        点击任意一个键位开始录制，按 Esc 取消。光标在输入框里时，窗口内的快捷键不生效——打字不会顺带把歌切了。
      </p>
    </Rows>
  )
}
