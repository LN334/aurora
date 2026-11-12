import { bridge, isNative } from '../../bridge'
import { usePlayer } from '../player/store'
import { useUpdate } from './store'

/**
 * 已经下好的新版，什么时候换上。
 *
 * 只管自动那条路的最后一步：下载由主进程的定时检查负责（见
 * electron/updates.ts 的 autoCheck），这里不查也不下。手动下载的结果带着
 * origin: 'manual'，一律不碰——那是用户自己取回来的文件，装必须等他按。
 *
 * 三个条件全满足才动手：开关开着（设置 → 更新 → 自动更新）、结果已经是
 * ready、这会儿没在放歌。正在听的时候把窗口关掉重启，比多等一首歌糟得多。
 *
 * 「检查更新」按钮不经过这里——那条路只问 GitHub 有没有新版，结果停在
 * available，等用户按「下载」。手动检查永远不会把应用换掉。
 */

let armed = false
let installing = false

export function armAutoRestart(): void {
  if (!isNative || armed) return
  armed = true

  useUpdate.subscribe((state, prev) => {
    if (state.result === prev.result) return
    if (state.result?.state === 'ready') void maybeInstall()
  })

  // 正在放的时候不下手；这一首停了再来一次。
  usePlayer.subscribe((state, prev) => {
    if (prev.playing && !state.playing) void maybeInstall()
  })

  // 启动时可能已经下好了一份（上一轮下完、播放没停就退出了）。
  void maybeInstall()
}

async function maybeInstall(): Promise<void> {
  if (installing) return
  const result = useUpdate.getState().result
  if (!result || result.state !== 'ready') return
  // 手动下载的不归这里管：用户点了下载，装还是等他按。
  if (result.origin !== 'auto') return
  if (usePlayer.getState().playing) return

  let allowed = false
  try {
    allowed = (await bridge.updates.getPrefs()).autoInstall
  } catch {
    return
  }
  if (!allowed) return

  // 问设置和拿状态之间可能已经开始放了，装之前再看一眼。
  if (usePlayer.getState().playing) return
  if (useUpdate.getState().result?.state !== 'ready') return

  /* 一条日志：自动装会关窗口，出事时得能从头文件里看出是它干的。 */
  console.log('[update] auto install', result.info.version)
  installing = true
  try {
    await useUpdate.getState().install()
  } finally {
    installing = false
  }
}
