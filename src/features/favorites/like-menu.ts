import { create } from 'zustand'
import type { Track } from '../../types'

/**
 * 「喜欢到哪个平台」的小浮层。
 *
 * 行上的心形按钮只管一件事：让这首歌出现在某个「我喜欢的音乐」里。
 * 一首歌同时在两三家平台存在时，必须先选落点，所以按钮把选择交给这里，
 * 由一处全局状态托管，列表行不必各自保存弹出状态。
 */

interface LikeMenuRequest {
  track: Track
  /** 弹出的位置，视口坐标。 */
  x: number
  y: number
}

interface LikeMenuState {
  open: LikeMenuRequest | null
  show(request: LikeMenuRequest): void
  close(): void
}

export const useLikeMenu = create<LikeMenuState>()((set) => ({
  open: null,
  show: (request) => set({ open: request }),
  close: () => set({ open: null })
}))
