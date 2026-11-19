import { create } from 'zustand'
import type { PartyNow, PartyState } from '../../env'
import { player } from '../player/actions'
import { usePlayer } from '../player/store'
import { HOLD_MS, playStateFor, sawSeek, seekTarget } from './pure'
import type { PlaybackTick } from './pure'

/**
 * 一起听的界面状态。
 *
 * 房间的真相在主进程（那里才有 WebSocket 服务），这里只做两件事：把推上来的
 * 状态存住，把命令转过去。浏览器预览里 `window.aurora.party` 不存在，命令会
 * 落到 bridge 的空实现，界面据此提示「只在桌面版可用」。
 */

const IDLE: PartyState = { role: 'idle', address: '', code: '', members: [], now: null, error: '' }

/**
 * 房主每隔这么久报一次自己的位置。
 *
 * 不逐秒广播——那会把网络当播放器用；也不只在切歌时报——那样两个人各走各的，
 * 一首歌放完能差出小半首。4 秒配合客人的 2 秒校正，稳态差不到阈值。
 */
const HEARTBEAT_MS = 4000

/** 客人这边多久校一次位置。 */
const ALIGN_MS = 2000

/** 自己刚拖过位置之后，这段时间内的跳变不算「用户在拖」。 */
const SELF_SEEK_GRACE_MS = 1000

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
let lastPlaying = false
/** 客人最近一次自己拖过进度的时刻；之前的时间窗里不去把他拉回房主那儿。 */
let holdUntil = 0
/** 我们自己的 seek 时刻：那一下的跳变不是用户拖的。 */
let selfSeekAt = 0
/** 上一次播放采样，用来认出「这次位置跳了一截」。 */
let lastTick: PlaybackTick | null = null

/** 换房间就忘掉上一个房间的采样，免得旧位置被当成这一次的拖动。 */
function resetWatch(): void {
  lastTrackId = ''
  lastPlaying = false
  lastTick = null
  holdUntil = 0
}

/** 把「现在听什么、听到哪」报给房间。 */
function pushMoment(): void {
  const playback = usePlayer.getState()
  const track = playback.queue[playback.index] ?? null
  if (!track) return
  void useParty.getState().push({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    at: Date.now(),
    position: playback.position,
    playing: playback.playing
  })
}

/**
 * 客人跟着房主切歌。
 *
 * 房间里同步的是 id，不是音频：这首歌必须在客人自己的队列里，才有得放。
 * 不在就留下一条说明，界面照实显示——而不是假装切换成功。
 */
function follow(now: PartyNow): void {
  const { queue, order } = usePlayer.getState()
  const index = queue.findIndex((track) => track.id === now.trackId)
  if (index < 0) {
    useParty.setState((current) => ({
      state: { ...current.state, error: '房主在放一首不在你队列里的歌' }
    }))
    return
  }
  const orderPosition = order.indexOf(index)
  if (orderPosition < 0) return
  /* 房主换的新歌：位置从头对齐，把「刚拖过」的抑制窗口收掉。 */
  holdUntil = 0
  player.jumpTo(orderPosition)
  /* 房主是暂停着换的歌，别让这一跳自己放起来。 */
  if (!now.playing) player.pause()
}

/**
 * 把这边拉到房主那儿。
 *
 * 位置与起停分开判断：位置只在差过阈值时才拖，起停只要不一致就跟。两边都由
 * 消息触发一次，再靠定时器补漏——切歌那一帧元素可能还没装好，那一次 seek 会
 * 落空，靠 2 秒后的那一次接上。
 */
function alignWith(now: PartyNow): void {
  const playback = usePlayer.getState()
  const at = Date.now()
  const local = { position: playback.position, playing: playback.playing }
  const target = seekTarget(now, local, at, at < holdUntil)
  const wanted = playStateFor(now, local)

  if (wanted === true) player.play()
  else if (wanted === false) player.pause()

  if (target !== null) {
    selfSeekAt = at
    player.seekTo(target)
  }
}

/**
 * 订一份播放状态，房主与客人各取所需。
 *
 * 房主：换歌、起停都立刻报一声——这是房间存在的主要理由，不该靠手点。
 *
 * 客人：认出「自己拖了进度」。正常播放时位置按时间前进，突然跳出一大截只能
 * 是拖了进度条；这时记下抑制窗口，免得下一条消息立刻把人拽回去。
 */
function watchPlayback(): void {
  if (watching) return
  watching = true

  usePlayer.subscribe((state) => {
    const role = useParty.getState().state.role

    if (role === 'host') {
      const track = state.queue[state.index] ?? null
      if (!track) return
      if (track.id !== lastTrackId) {
        lastTrackId = track.id
        lastPlaying = state.playing
        pushMoment()
        return
      }
      if (state.playing !== lastPlaying) {
        lastPlaying = state.playing
        pushMoment()
      }
      return
    }

    if (role !== 'guest') return

    const sample: PlaybackTick = {
      trackId: state.queue[state.index]?.id ?? '',
      position: state.position,
      playing: state.playing,
      at: Date.now()
    }
    const before = lastTick
    lastTick = sample
    if (!before) return
    /* 我们自己的 seek 也会让位置跳一下，别把它当成用户在拖。 */
    if (Date.now() - selfSeekAt < SELF_SEEK_GRACE_MS) return
    if (sawSeek(before, sample)) holdUntil = Date.now() + HOLD_MS
  })

  window.setInterval(() => {
    const { role } = useParty.getState().state
    /* 暂停时位置不动，再报也是同一条；起停那一下已经由订阅报过了。 */
    if (role !== 'host' || !usePlayer.getState().playing) return
    pushMoment()
  }, HEARTBEAT_MS)

  window.setInterval(() => {
    const { role, now } = useParty.getState().state
    if (role === 'guest' && now) alignWith(now)
  }, ALIGN_MS)
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
      if (state.role !== 'guest' || !state.now) return
      /*
       * 房主换了歌，客人跟着换。
       *
       * 只在 trackId 真的变了才动：同一条 now 会被广播多次（有人进出房间时
       * 也会带一份完整状态），每次都跳一遍会让客人刚拖到的位置被打回去。
       */
      if (state.now.trackId !== previous.now?.trackId) {
        follow(state.now)
        return
      }
      /* 同一首歌里的位置与起停，按消息校一次；剩下的交给定时器。 */
      alignWith(state.now)
    })
    watchPlayback()
    void bridge.state().then((state) => {
      if (state) set({ state })
    })
  },

  async host(name) {
    set({ busy: true })
    resetWatch()
    try {
      const state = await window.aurora?.party?.host(name)
      if (state) set({ state })
    } finally {
      set({ busy: false })
    }
  },

  async join(address, code, name) {
    set({ busy: true })
    resetWatch()
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
