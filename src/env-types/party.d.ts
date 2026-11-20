/**
 * 一起听：房间、成员、消息与樱花隧道。
 *
 * 从 `env.d.ts` 按声明块整体搬出来：那一份把应用侧、播放、一起听与五个平台
 * 全塞在一千六百多行里，找东西只能靠搜索。
 */
export interface PartyMember {
  id: string
  name: string
  host: boolean
}

/** 樱花隧道进程的状态。 */
export interface TunnelState {
  running: boolean
  /** 拿到的公网地址（`host:端口`）；空串是还没有。 */
  address: string
  /** 最近一行输出，给「在动」一个可见的迹象。 */
  line: string
  error: string
}

/** 房间里的一句话。 */
export interface PartyMessage {
  id: string
  name: string
  text: string
  at: number
  /** 房主说的话，界面上靠另一边。 */
  host: boolean
}

/** 房间里「现在在听什么」。 */
export interface PartyNow {
  trackId: string
  title: string
  artist: string
  at: number
  position: number
  playing: boolean
  /** 这首歌是什么。客人队列里没有它时，靠这份描述就地装进来。 */
  track?: {
    id: string
    source: string
    title: string
    artist: string
    album: string
    duration: number
    coverUrl: string | null
    hasArt: boolean
  }
  /**
   * 房主手上那份播放地址。
   *
   * 一起听共享的是「听什么」，声音本来是各取各的；但只要房主把地址带过来，
   * 客人就能听到和房主同一档音质——他用的母带，你听到的就是母带。地址有
   * 时效，所以随每次心跳重推。
   */
  stream?: {
    /** 转发路径；主机由客人按自己连进来的地址补。 */
    url: string
    quality: string
    /** `relay` 是经房主房间转发；`direct` 是平台直链原样给的。 */
    via?: 'relay' | 'direct'
  }
}

export interface PartyState {
  role: 'host' | 'guest' | 'idle'
  address: string
  /** 房主的全部本机地址候选；多网卡时房主自己挑一个发出去。 */
  addresses: string[]
  code: string
  members: PartyMember[]
  now: PartyNow | null
  /** 房主填的公网地址（`host:端口`）；空串是没有。 */
  publicAddress: string
  /** 房主是否替房间转发音频；关着就各取各的。 */
  relay: boolean
  /** 房间里最近的话；中途进来的人也看得到上一段。 */
  messages: PartyMessage[]
  error: string
}

/** 一起听：局域网房间。状态由主进程推，命令往下发。 */
export interface PartyApi {
  host(name: string, port?: number): Promise<PartyState>
  join(address: string, code: string, name: string): Promise<PartyState>
  leave(): Promise<PartyState>
  pushNow(now: PartyNow): Promise<PartyState>
  chat(text: string): Promise<PartyState>
  /** 房主填公网地址；客人调用无效果。 */
  setPublic(address: string): Promise<PartyState>
  /** 房主把当前这首的播放地址交给房间转发，返回地址里用的令牌。 */
  registerStream(trackId: string, url: string): Promise<string>
  /** 房主开关转发；客人调用无效果。 */
  setRelay(relay: boolean): Promise<PartyState>
  /** 打开聊天室页（单例窗口）。 */
  openChat(): Promise<boolean>
  /** 打开房间窗口（单例）。 */
  openWindow(): Promise<boolean>
  /** 找 frpc 并验一次能不能跑。 */
  sakuraFrpc(): Promise<{ path: string; ok: boolean; message: string }>
  /** 登录樱花：开一扇内嵌登录窗，登录后自动带回访问密钥。 */
  sakuraLogin(): Promise<{ ok: boolean; token: string; message: string }>
  /** 打开樱花隧道页（单例窗口）。 */
  openSakura(): Promise<boolean>
  /** 节点列表：建隧道要选一个。 */
  sakuraNodes(token: string): Promise<{
    ok: boolean
    message: string
    nodes: { id: number; name: string; vip: number; flag: number; band: string }[]
  }>
  /** 建一条隧道。 */
  sakuraCreate(input: {
    token: string
    name: string
    node: number
    localPort: number
    remote?: string
  }): Promise<{ ok: boolean; message: string; id: number }>
  /** 改一条隧道的备注或本地端口。 */
  sakuraEdit(input: {
    token: string
    id: number
    note?: string
    localPort?: number
  }): Promise<{ ok: boolean; message: string }>
  /** 用访问密钥换樱花隧道列表。 */
  sakuraTunnels(token: string): Promise<{
    ok: boolean
    message: string
    tunnels: { id: number; name: string; node: string; type: string; localPort: number; remotePort: number; online: boolean }[]
    raw: string
  }>
  /** 起樱花隧道（官方独立版 frpc）。 */
  tunnelStart(config: { frpcPath: string; token: string; tunnelId: string }): Promise<TunnelState>
  tunnelStop(): Promise<TunnelState>
  tunnelState(): Promise<TunnelState>
  onTunnel(listener: (state: TunnelState) => void): () => void
  state(): Promise<PartyState>
  onState(listener: (state: PartyState) => void): () => void
}

