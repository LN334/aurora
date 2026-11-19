import { create } from 'zustand'
import type { PartyNow, PartyState, TunnelState } from '../../env'
import { QUALITY_SHORT } from '../online/types'
import { useOnlineStore } from '../online/store'
import { player } from '../player/actions'
import { usePlayer } from '../player/store'
import { rememberSharedStream } from './shared-stream'
import { partyTrackInfoOf, trackFromParty } from './shared-track'
import { HOLD_MS, playStateFor, sawSeek, seekTarget } from './pure'
import type { PlaybackTick } from './pure'

/**
 * 一起听的界面状态。
 *
 * 房间的真相在主进程（那里才有 WebSocket 服务），这里只做两件事：把推上来的
 * 状态存住，把命令转过去。浏览器预览里 `window.aurora.party` 不存在，命令会
 * 落到 bridge 的空实现，界面据此提示「只在桌面版可用」。
 */

const IDLE: PartyState = {
  role: 'idle',
  address: '',
  code: '',
  members: [],
  now: null,
  publicAddress: '',
  relay: true,
  messages: [],
  error: ''
}

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
  tunnel: TunnelState
  busy: boolean
  init(): void
  host(name: string): Promise<void>
  join(address: string, code: string, name: string): Promise<void>
  leave(): Promise<void>
  push(now: PartyNow): Promise<void>
  say(text: string): Promise<void>
  setPublic(address: string): Promise<void>
  setRelay(relay: boolean): Promise<void>
  startTunnel(config: { frpcPath: string; token: string; tunnelId: string }): Promise<void>
  stopTunnel(): Promise<void>
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
  /*
   * 把房主手上这份流一起带过去。
   *
   * 一起听共享的是「听什么」，声音本来各取各的；带上地址之后，客人听到的就是
   * 房主这一档——他选了母带，你听到的也是母带，不是你自己账号能给的那一档。
   * 地址有时效，所以每次心跳都重推一次，不缓存。
   */
  /*
   * 地址怎么给客人，分三种：
   *
   * 1. 房间有公开地址（局域网 IP 或穿透出来的域名）→ 给房间自己的转发地址，
   *    由房主这台机器代拉。平台的直链认 IP 时，这是唯一能让对面听到的方式。
   * 2. 没有公开地址，但房主手上确实有直链 → 原样给出去。
   * 3. 都没有 → 不给，客人各自解析。
   */
  const party = useParty.getState().state
  const base = party.publicAddress || party.address
  /*
   * 房主关掉转发时什么都不推：不转发也不把直链递过去。这个开关的意思就是
   * 「别拿我的账号给别人听」，只关一半等于没关。
   */
  if (!party.relay) {
    const info = partyTrackInfoOf(track)
    void useParty.getState().push({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      at: Date.now(),
      position: playback.position,
      playing: playback.playing,
      ...(info ? { track: info } : {})
    })
    return
  }
  if (playback.streamUrl && base) {
    /*
     * 先向主进程要一个令牌，再把地址推出去。
     *
     * 地址里不能放歌曲 id：房间码挡的是「进房间」，挡不住有人照着 /stream/
     * 拼一个地址来白拉音频。令牌是随机的，短命，换歌多了会被挤掉。
     */
    const url = playback.streamUrl
    const quality = qualityNameOf(track)
    void window.aurora?.party
      ?.registerStream(track.id, url)
      .then((token) => {
        if (!token) return
        /*
         * 拿令牌期间房主可能已经切了歌。这条消息仍然发出去也不会错——房间按
         * 「最后一条 now 为准」，晚到的是更旧的 track，会被下一次心跳覆盖；
         * 但为了避免把上一首又顶回去一次，这里对一下当前曲目。
         */
        const state = usePlayer.getState()
        if (state.queue[state.index]?.id !== track.id) return
        const info = partyTrackInfoOf(track)
        void useParty.getState().push({
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          at: Date.now(),
          position: state.position,
          playing: state.playing,
          ...(info ? { track: info } : {}),
          stream: { url: 'http://' + base + '/stream/' + token, quality }
        })
      })
    return
  }

  const stream = playback.streamUrl ? { url: playback.streamUrl, quality: qualityNameOf(track) } : undefined
  const info = partyTrackInfoOf(track)
  void useParty.getState().push({
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    at: Date.now(),
    position: playback.position,
    playing: playback.playing,
    ...(info ? { track: info } : {}),
    ...(stream ? { stream } : {})
  })
}

/** 房主这台机器上，这首歌所属平台当前选的是哪一档。 */
function qualityNameOf(track: { source?: string }): string {
  const source = track.source
  if (!source || source === 'local') return ''
  const tier = useOnlineStore(source).getState().quality
  return tier ? (QUALITY_SHORT[tier] ?? '') : ''
}

/**
 * 客人跟着房主切歌。
 *
 * 房间里同步的是 id，不是音频：这首歌必须在客人自己的队列里，才有得放。
 * 不在就留下一条说明，界面照实显示——而不是假装切换成功。
 */
function follow(now: PartyNow): void {
  let { queue, order } = usePlayer.getState()
  let index = queue.findIndex((track) => track.id === now.trackId)
  if (index < 0) {
    /*
     * 客人这边没有这首。
     *
     * 以前到这里就断了——「房主在放一首不在你队列里的歌」。房主现在会把曲目
     * 描述一起推过来，在线曲可以就地装进队列；配合他带过来的播放地址，客人
     * 有没有那个平台的账号、有没有会员，都不影响他听到。
     *
     * 本机文件装不了：对面没有那个文件，推一个路径过来也放不出声。
     */
    const rebuilt = now.track ? trackFromParty(now.track) : null
    if (!rebuilt) {
      useParty.setState((current) => ({
        state: { ...current.state, error: '房主在放一首不在你队列里的歌，而且这首是本机文件' }
      }))
      return
    }
    usePlayer.getState().enqueue([rebuilt], 'next')
    ;({ queue, order } = usePlayer.getState())
    index = queue.findIndex((track) => track.id === now.trackId)
    if (index < 0) return
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
  /*
   * 房主那首得先在这台机器的队列里。不在时 follow 已经留过话，这里再对着它调
   * play() 只会在一个空元素上反复失败——那是每两秒一条日志，不是同步。
   */
  if (playback.queue[playback.index]?.id !== now.trackId) return
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
  tunnel: { running: false, address: '', line: '', error: '' },
  busy: false,

  init() {
    if (wired) return
    wired = true
    const bridge = typeof window === 'undefined' ? undefined : window.aurora?.party
    if (!bridge) return
    /*
     * 隧道一拿到地址就直接写进房间：房主不该还要复制一遍再粘贴到上面那格。
     * 只写一次——同一条地址重复推送会把别人刚改的值覆盖掉。
     */
    bridge.onTunnel?.((tunnel) => {
      set({ tunnel })
      if (tunnel.address && tunnel.address !== get().state.publicAddress && get().state.role === 'host') {
        void get().setPublic(tunnel.address)
      }
    })
    void bridge.tunnelState?.().then((tunnel) => {
      if (tunnel) set({ tunnel })
    })
    bridge.onState((state) => {
      /*
       * 房主带了地址就记下来，取流那头会优先用它——这是「音质也同步」的实现点：
       * 同一份地址，听到的就是同一档。
       */
      rememberSharedStream(
        state.now?.stream
          ? { trackId: state.now.trackId, url: state.now.stream.url, quality: state.now.stream.quality }
          : null
      )
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

  async startTunnel(config) {
    const tunnel = await window.aurora?.party?.tunnelStart(config)
    if (tunnel) set({ tunnel })
  },

  async stopTunnel() {
    const tunnel = await window.aurora?.party?.tunnelStop()
    if (tunnel) set({ tunnel })
  },

  async setRelay(relay) {
    const state = await window.aurora?.party?.setRelay(relay)
    if (state) set({ state })
  },

  async setPublic(address) {
    const state = await window.aurora?.party?.setPublic(address)
    if (state) set({ state })
  },

  async say(text) {
    const state = await window.aurora?.party?.chat(text)
    if (state) set({ state })
    else {
      // 同 push：浏览器里没有后端，说清楚，而不是让输入框看起来发过
      set({ state: { ...get().state, error: '浏览器预览模式没有一起听后端' } })
    }
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
