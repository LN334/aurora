import { powerSaveBlocker } from 'electron'
import { loadSettings } from './settings'

/**
 * 播放时的系统休眠闸门。
 *
 * 用 `prevent-app-suspension`：它拦住的是「系统因闲置而挂起」，显示器关闭与屏幕保护
 * 仍按用户自己的电源计划走。音乐播放器要的是「别在放歌的时候睡着」，不是替用户
 * 改显示设置——后者会让一个后台播放器把屏幕一直点亮，那是更糟的事。
 *
 * 只在真正开始播放时握住，暂停就放开——否则一个开着就不放的播放器会把笔记本的
 * 电池耗干，那是比睡过去更严重的失败。
 */
let blockerId: number | null = null

export function syncSleepBlocker(playing: boolean): void {
  const wanted = playing && loadSettings().preventSleepWhilePlaying
  const holding = blockerId !== null && powerSaveBlocker.isStarted(blockerId)

  if (wanted && !holding) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
    return
  }

  if (!wanted && holding && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }

  // 系统在休眠/唤醒时会自行清掉 blocker，这里把持有的引用一并校正，
  // 免得下次判断以为自己还握着。
  if (!wanted) blockerId = null
}

/** 退出前释放，避免留下一个没人管的 blocker。 */
export function releaseSleepBlocker(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId)
  }
  blockerId = null
}
