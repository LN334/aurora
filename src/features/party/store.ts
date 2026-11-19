import { create } from 'zustand'
import type { PartyNow, PartyState } from '../../env'
import { usePlayer } from '../player/store'

/**
 * 一起听的界面状态。
 *
 * 房间的真相在主进程（那里才有 WebSocket 服务），这里只做两件事：把推上来的
 * 状态存住，把命令转过去。浏览器预览里 `window.aurora.party` 不存在，命令会
 * 落到 bridge 的空实现，界面据此提示「只在桌面版可用」。
 */

const IDLE: PartyState = { role: 'idle', address: '', code: '', members: [], now: null, error: '' }

interface PartyStore {
  state: PartyState
  busy: boolean
  init(): void
  host(name: string): Promise<void>
  join(address: string, code: string, name: string): Promise<void>
  leave(): Promise<void>
  push(now: PartyNow): Promise<void>
}

let wired = false
let watching = false
let lastTrackId = ''

/**
 * 切歌自动同步。
 *
 * 房主每换一首就把「现在听什么」推出去，其他人跟着换——这是房间存在的主要
 * 理由，不该靠手点。只推切歌这一刻：进度不逐秒广播，那会把网络当播放器用。
 * 离开房间后 `role` 不再是 host，订阅自然什么都不做，不必解绑。
 */
function watchPlayback(): void {
  if (watching) return
  watching = true
  usePlayer.subscribe((state) => {
    if (useParty.getState().state.role !== 'host') return
    const track = state.queue[state.index] ?? null
    if (!track || track.id === lastTrackId) return
    lastTrackId = track.id
    void useParty.getState().push({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      at: Date.now(),
      position: Math.floor(state.position ?? 0),
      playing: state.playing
    })
  })
}

export const useParty = create<PartyStore>((set, get) => ({
  state: IDLE,
  busy: false,

  init() {
    if (wired) return
    wired = true
    const bridge = typeof window === 'undefined' ? undefined : window.aurora?.party
    if (!bridge) return
    bridge.onState((state) => set({ state }))
    watchPlayback()
    void bridge.state().then((state) => {
      if (state) set({ state })
    })
  },

  async host(name) {
    set({ busy: true })
    try {
      const state = await window.aurora?.party?.host(name)
      if (state) set({ state })
    } finally {
      set({ busy: false })
    }
  },

  async join(address, code, name) {
    set({ busy: true })
    try {
      const state = await window.aurora?.party?.join(address, code, name)
      if (state) set({ state })
    } finally {
      set({ busy: false })
    }
  },

  async leave() {
    const state = await window.aurora?.party?.leave()
    set({ state: state ?? IDLE })
  },

  async push(now) {
    const state = await window.aurora?.party?.pushNow(now)
    if (state) set({ state })
    else {
      // 浏览器里没有后端：给一句明确的失败，而不是让按钮看起来按过就算了
      set({ state: { ...get().state, error: '浏览器预览模式没有一起听后端' } })
    }
  }
}))
