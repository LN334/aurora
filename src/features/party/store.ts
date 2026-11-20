import { create } from 'zustand'
import type { PartyNow, PartyState, TunnelState } from '../../env'
import { useAccounts } from '../accounts/store'
import { QUALITY_SHORT } from '../online/types'
import { useOnlineStore } from '../online/store'
import { player } from '../player/actions'
import { usePlayer } from '../player/store'
import { rememberSharedOrigin, rememberSharedStream } from './shared-stream'
import { partyTrackInfoOf, trackFromParty } from './shared-track'
import { normalizeCode, parseInvite } from './invite'
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
  addresses: [],
  code: '',
  name: '',
  members: [],
  now: null,
  publicAddress: '',
  relay: true,
  locked: false,
  connecting: false,
  refused: '',
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
  join(address: string, code: string, name: string, pass?: string): Promise<void>
  leave(): Promise<void>
  push(now: PartyNow): Promise<void>
  say(text: string): Promise<void>
  setPublic(address: string): Promise<void>
  /** 房主给房间改名；客人调用无效果。 */
  rename(name: string): Promise<void>
  /** 房主给房间上锁；空串是解锁。客人调用无效果。 */
  setPassword(password: string): Promise<void>
  /** 房主把随机房间码改成自己好念的一串；客人调用无效果。 */
  setCode(code: string): Promise<void>
  /** 只凭房间码在同一个网络里找房；找不到返回 null，由界面让房主发地址。 */
  discover(code: string): Promise<{ address: string; name: string; locked: boolean } | null>
  /** 房主把某个成员请出房间；客人调用无效果。 */
  kick(id: string): Promise<void>
  setRelay(relay: boolean): Promise<void>
  /** Cloudflare 快速隧道：不用账号与备案，地址随进程变。 */
  cloudflare: TunnelState
  startCloudflare(): Promise<void>
  stopCloudflare(): Promise<void>
  startTunnel(config: { frpcPath: string; token: string; tunnelId: string }): Promise<void>
  stopTunnel(): Promise<void>
  /** 清空日志面板。 */
  clearTunnelLog(): Promise<void>
}

let wired = false
/** 「我想待在这一间」：客人断线后据此自动回去；null 表示不打算在房间里。 */
let wantIn: { address: string; code: string; name: string; pass: string } | null = null
/** 已经重试过几次，退避用。 */
let attempt = 0
let watching = false
let lastTrackId = ''
let lastPlaying = false
/** 客人最近一次自己拖过进度的时刻；之前的时间窗里不去把他拉回房主那儿。 */
let holdUntil = 0
/** 最近一次由隧道写进房间的公网地址；用来判断断开时该不该撤。 */
let tunnelPublished = ''
/** Cloudflare 隧道写进去的那一条，断开时要撤掉——地址随进程变，留下的只能是死链。 */
let cloudflarePublished = ''
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
          stream: { url: '/stream/' + token, quality, via: 'relay' }
        })
      })
    return
  }

  const stream = playback.streamUrl
    ? { url: playback.streamUrl, quality: qualityNameOf(track), via: 'direct' as const }
    : undefined
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
  tunnel: { running: false, address: '', line: '', error: '', log: [] },
  cloudflare: { running: false, address: '', line: '', error: '', log: [] },
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
        tunnelPublished = tunnel.address
      }
      /*
       * 隧道断了，房间的公网地址要跟着撤。
       *
       * 不撤的话客人手上还留着一条连不上的地址，点加入就是「连不上房主」，
       * 而房主那边看起来一切正常。只撤隧道自己写进去的那个值——房主手填的
       * 地址不受影响。
       */
      if (!tunnel.running && !tunnel.address && get().state.role === 'host') {
        if (tunnelPublished && get().state.publicAddress === tunnelPublished) {
          tunnelPublished = ''
          void get().setPublic('')
        }
      }
    })
    void bridge.tunnelState?.().then((tunnel) => {
      if (tunnel) set({ tunnel })
    })
    /*
     * Cloudflare 隧道：地址一出现就写进房间，断开就撤回。
     *
     * 地址是随机的、进程一停就失效；留在房间页上就是一条连不上的公网入口，
     * 客人拿着邀请链接只会反复重试。所以它和樱花那条一样要「来去成对」。
     * 唯一区别：不覆盖房主自己填的地址，只在那一栏空着时自动填。
     */
    bridge.cloudflare?.onState?.((cloudflare) => {
      set({ cloudflare })
      const party = get().state
      if (party.role !== 'host') return
      if (cloudflare.address && !party.publicAddress) {
        cloudflarePublished = cloudflare.address
        void get().setPublic(cloudflare.address)
      }
      if (!cloudflare.address && cloudflarePublished && party.publicAddress === cloudflarePublished) {
        cloudflarePublished = ''
        void get().setPublic('')
      }
    })
    void bridge.cloudflare?.state?.().then((cloudflare) => {
      if (cloudflare) set({ cloudflare })
    })
    bridge.onState((state) => {
      /*
       * 被房主拒掉（房间码不对、密码不对）不是「意外断线」：拿着同一条链接
       * 再试一百次也是同一个结果。这时必须放下「我想待在这一间」，否则界面
       * 刚说完原因，转头就开始自动重连，最后停在一个连不上的空房间里。
       */
      if (state.refused) {
        wantIn = null
        attempt = 0
      }
      /*
       * 客房断线后自己回去。
       *
       * 房主那边可能因为换端口把房间重开了一次，客人这边看到的就是「突然掉出房间」。
       * 只要用户没主动离开（wantIn 还在），就退避着重连——1s、2s、4s、8s，最多四轮。
       * 主动 leave 会清掉 wantIn，所以不会把人硬拉回一个他已经不想待的房间。
       */
      if (state.role === 'idle' && wantIn && attempt < 4) {
        const target = wantIn
        const wait = 1000 * 2 ** attempt
        attempt += 1
        window.setTimeout(() => {
          if (wantIn === target && useParty.getState().state.role === 'idle') {
            void useParty.getState().join(target.address, target.code, target.name, target.pass)
          }
        }, wait)
      }
      if (state.role !== 'idle') attempt = 0
      /*
       * 房主带了地址就记下来，取流那头会优先用它——这是「音质也同步」的实现点：
       * 同一份地址，听到的就是同一档。
       */
      rememberSharedStream(
        state.now?.stream
          ? {
              trackId: state.now.trackId,
              ...(state.now.stream.via === 'relay'
                ? { path: state.now.stream.url }
                : { url: state.now.stream.url }),
              quality: state.now.stream.quality
            }
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
    /*
     * 有人点了邀请链接。主进程把原文递过来，解析在这一侧做——两边共用一份
     * 规则，才不会出现「主进程认、页面不认」的分叉。
     *
     * 收到链接的意思是「我要进这一间」，所以先离了当前的房间再进去：不然
     * 主进程那边会先停掉房间再开始，界面在中间会闪一下「已离开」。
     */
    bridge.onInvite?.((link) => {
      const invite = parseInvite(link)
      if (!invite || !invite.place || !invite.code) {
        set({ state: { ...get().state, error: '这条邀请链接不完整：里面没有地址或房间码' } })
        return
      }
      void (async () => {
        if (get().state.role !== 'idle') await get().leave()
        window.location.hash = '#party'
        await get().join(invite.place, invite.code, '听众')
      })()
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
      /*
       * 端口记在本机：固定下来之后，樱花隧道里那个「本地端口」只要配一次。
       * 没填过就交 0，房间随机挑一个。
       */
      const saved = Number(localStorage.getItem('aurora.party.port') ?? '')
      /* 名字就是当前档案名：切换档案等于换身份，别再多存一份「一起听用的名字」。 */
      const who = useAccounts.getState().active()?.label?.trim() || name
      const state = await window.aurora?.party?.host(who, Number.isInteger(saved) ? saved : 0)
      if (state) {
        /*
         * 主进程是「先定房主、端口等监听成功再补」，所以它同步返回的那份快照里
         * 地址还是空的。监听往往在返回值之前就成功了，广播先到、界面先有了地址；
         * 再用这份空地址盖回去，界面就永远停在「局域网 · 正在起」，直到下一次
         * 有人说话才突然补上。空地址不覆盖已有地址，就这一条。
         */
        set((prev) => ({ state: state.address || !prev.state.address ? state : prev.state }))
        /* 设置里关掉了「替房间转发」，开房后就照它改一次；房间页里的开关仍可随时改。 */
        if (localStorage.getItem('aurora.party.relay') === '0') void get().setRelay(false)
      }
    } finally {
      set({ busy: false })
    }
  },

  async join(address, code, name, pass = '') {
    set({ busy: true })
    resetWatch()
    const who = useAccounts.getState().active()?.label?.trim() || name
    /* 记下「我想在这一间」：断线之后靠它自动回去，直到用户主动离开。 */
    wantIn = {
      address: address.trim(),
      code: normalizeCode(code),
      name: who,
      pass: pass.trim()
    }
    attempt = 0
    // 记下这次连的是哪个地址：房主给的转发是相对路径，主机要按这个补。
    rememberSharedOrigin(address.trim())
    try {
      const state = await window.aurora?.party?.join(address, code, who, pass)
      if (state) set({ state })
    } finally {
      set({ busy: false })
    }
  },

  async leave() {
    /* 主动离开就不再自动回去——与「意外断线」是两件事。 */
    wantIn = null
    const state = await window.aurora?.party?.leave()
    set({ state: state ?? IDLE })
    /*
     * 退房之后房主那条地址就不该再用了：它可能已经失效，拿着它播只会在
     * 超时之后才回退。清掉，下一首直接走自己的音源。
     */
    rememberSharedStream(null)
  },

  async startTunnel(config) {
    const tunnel = await window.aurora?.party?.tunnelStart(config)
    if (tunnel) set({ tunnel })
  },

  async stopTunnel() {
    const tunnel = await window.aurora?.party?.tunnelStop()
    if (tunnel) set({ tunnel })
  },

  async startCloudflare() {
    const cloudflare = await window.aurora?.party?.cloudflare?.start()
    if (cloudflare) set({ cloudflare })
  },

  async stopCloudflare() {
    const cloudflare = await window.aurora?.party?.cloudflare?.stop()
    if (cloudflare) set({ cloudflare })
  },

  async clearTunnelLog() {
    const tunnel = await window.aurora?.party?.tunnelLogClear()
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

  async rename(name) {
    const state = await window.aurora?.party?.rename(name)
    if (state) set({ state })
  },

  async setPassword(password) {
    const state = await window.aurora?.party?.setPassword(password)
    if (state) set({ state })
  },

  async setCode(code) {
    const state = await window.aurora?.party?.setCode(code)
    if (state) set({ state })
  },

  async discover(code) {
    const hit = await window.aurora?.party?.discover(code)
    return hit ?? null
  },

  async kick(id) {
    const state = await window.aurora?.party?.kick(id)
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
