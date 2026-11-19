import { create } from 'zustand'
import type { PartyNow, PartyState } from '../../env'
import { player } from '../player/actions'
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
/**
 * 客人跟着房主切歌。
 *
 * 房间里同步的是 id，不是音频：这首歌必须在客人自己的队列里，才有得放。
 * 不在就留下一条说明，界面照实显示——而不是假装切换成功。
 */
function follow(trackId: string): void {
  const { queue, order } = usePlayer.getState()
  const index = queue.findIndex((track) => track.id === trackId)
  if (index < 0) {
    useParty.setState((current) => ({
      state: { ...current.state, error: '房主在放一首不在你队列里的歌' }
    }))
    return
  }
  const orderPosition = order.indexOf(index)
  if (orderPosition >= 0) player.jumpTo(orderPosition)
}

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
    bridge.onState((state) => {
      const previous = useParty.getState().state
      set({ state })
      /*
       * 房主换了歌，客人跟着换。
       *
       * 只在 trackId 真的变了才动：同一条 now 会被广播多次（有人进出房间时
       * 也会带一份完整状态），每次都跳一遍会让客人刚拖到的位置被打回去。
       */
      if (state.role === 'guest' && state.now && state.now.trackId !== previous.now?.trackId) {
        follow(state.now.trackId)
      }
    })
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
