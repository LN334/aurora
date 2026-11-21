import { useEffect } from 'react'
import { bridge } from '../bridge'
import { player } from '../features/player/actions'
import { KEY_STEP } from '../features/player/volume'
import { HOTKEYS, comboFor, comboOf } from '../features/hotkeys/binding'

/**
 * Transport and shell shortcuts, ignored while a field has focus.
 *
 * This is input handling and nothing else: which panels are open, what the volume
 * is, and what a key does. It lived in the middle of `App`, where the one thing a
 * reader needs to check - "does this shortcut fire while I am typing?" - was two
 * screens away from the key list.
 *
 * There are no shortcuts for the online screen or for jumping to a page on purpose:
 * the rail already says where you can go, and Overlay/Stage are the only panels
 * worth a bare letter. Escape is the exception: it is the one key people press
 * without looking, so it unwinds whatever sits on top of the page first (a panel),
 * and only then walks back through history.
 */
export function useKeyboardShortcuts(options: {
  stageOpen: boolean
  eqOpen: boolean
  queueOpen: boolean
  volume: number
  /** True when there is a page behind this one to walk back to. */
  canGoBack: boolean
  goBack(): void
  setStageOpen(update: (open: boolean) => boolean): void
  setEqOpen(update: (open: boolean) => boolean): void
  setQueueOpen(update: (open: boolean) => boolean): void
  /** 漫游：要一趟、立刻放、进播放页。与左栏那颗按钮同一个入口。 */
  roam(): void
}) {
  const {
    stageOpen,
    eqOpen,
    queueOpen,
    volume,
    canGoBack,
    goBack,
    setStageOpen,
    setEqOpen,
    setQueueOpen,
    roam
  } = options

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true
      if (typing) return

      /*
       * Esc 不进键位表：它要「一层一层往回退」，不是一个动作对一个键。
       */
      if (event.key === 'Escape') {
        if (stageOpen) setStageOpen(() => false)
        else if (eqOpen) setEqOpen(() => false)
        else if (queueOpen) setQueueOpen(() => false)
        else if (canGoBack) {
          event.preventDefault()
          goBack()
        }
        return
      }

      /*
       * 其余按键全按 user 表查：设置页改了什么，这里就立刻是什么。
       * 表里没有的组合直接放过——不让本应用吃掉浏览器/系统的默认行为。
       */
      const combo = comboOf(event)
      const hit = HOTKEYS.find((item) => item.scope === 'app' && comboFor(item.id) === combo)
      if (!hit) return

      const run: Record<string, () => void> = {
        search: () => document.getElementById('global-search')?.focus(),
        play: () => player.toggle(),
        next: () => player.next(),
        prev: () => player.prev(),
        seekForward: () => player.nudge(5),
        seekBack: () => player.nudge(-5),
        volumeUp: () => player.setVolume(volume + KEY_STEP),
        volumeDown: () => player.setVolume(volume - KEY_STEP),
        stage: () => setStageOpen((open) => !open),
        eq: () => setEqOpen((open) => !open),
        roam: () => roam(),
        fullscreen: () => void bridge.window.toggleFullscreen()
      }
      const action = run[hit.id]
      if (!action) return
      event.preventDefault()
      action()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stageOpen, eqOpen, queueOpen, volume, canGoBack, goBack, setStageOpen, setEqOpen, setQueueOpen, roam])
}
