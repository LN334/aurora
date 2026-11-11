import { bridge, isNative } from '../../bridge'
import { usePlayer } from '../player/store'
import { useUpdate } from './store'

/**
 * 发现新版就自己下，下好之后自己换版本。
 *
 * 主进程那一层刻意关掉 `autoInstallOnAppQuit`：安装包未签名，退出时静默替换
 * 没有回退的路（见 electron/updates.ts）。这里不是绕过那个决定——它在设置里
 * 是一个开关（「新版本自动下载并安装」），关掉就退回手动。
 *
 * 下载同样不等人：这个开关的文案是「自动下载并安装」，那就两步都做。发现
 * 新版、没在下、开关开着，就直接下；只有重启（install）等那一轮播放停下来——
 * 用户正听着，窗口突然重启，比多点一次按钮糟得多。
 */

let armed = false
let installing = false
let downloading = false

/** 等 store 把 busy 放下来：启动那次检查还没返回时，download() 会被 busy 挡住。 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function armAutoInstall(): void {
  if (!isNative || armed) return
  armed = true

  useUpdate.subscribe((state, prev) => {
    if (state.result === prev.result) return
    if (state.result?.state === 'available') void maybeDownload()
    if (state.result?.state === 'ready') void maybeInstall()
  })

  usePlayer.subscribe((state, prev) => {
    if (prev.playing && !state.playing) void maybeInstall()
  })

  // 启动时可能已经下好了一份（上个会话里下完、没来得及装）。
  void maybeInstall()
  void maybeDownload()
}

/**
 * 自动下载。
 *
 * 只认 available 一个状态：downloading / ready / error 都不在这里推进，免得
 * 下载失败后反复重试把上游当靶子。
 */
async function maybeDownload(): Promise<void> {
  if (downloading || !isNative) return
  const result = useUpdate.getState().result
  if (!result || result.state !== 'available') return

  let allowed = false
  try {
    allowed = (await bridge.updates.getPrefs()).autoInstall
  } catch {
    return
  }
  if (!allowed) return

  // 启动那次检查可能还没返回，store 的 busy 会把 download() 挡掉。
  for (let i = 0; i < 30 && useUpdate.getState().busy; i += 1) await wait(100)
  if (useUpdate.getState().result?.state !== 'available') return

  console.log('[update] auto download', result.info.version)
  downloading = true
  try {
    await useUpdate.getState().download()
  } finally {
    downloading = false
  }
}

async function maybeInstall(): Promise<void> {
  if (installing || !isNative) return
  const result = useUpdate.getState().result
  if (!result || result.state !== 'ready') return
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
