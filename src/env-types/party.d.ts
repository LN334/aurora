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
  /** 最近的原始日志（最多几百行），给日志面板看。 */
  log: string[]
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
  /** 房主起的房间名；空串表示还没起，界面用默认那句。 */
  name: string
  members: PartyMember[]
  now: PartyNow | null
  /** 房主填的公网地址（`host:端口`）；空串是没有。 */
  publicAddress: string
  /** 房主是否替房间转发音频；关着就各取各的。 */
  relay: boolean
  /**
   * 房间有没有上锁。
   *
   * 只是「有没有」这一位：密码本身不进这份状态——它会被广播给房间里所有人。
   */
  locked: boolean
  /**
   * 客人这一侧：还没收到房主的第一份状态。
   *
   * 这一段不该显示房间页——否则用户看到的是一个「0 人、没有歌」的空房间。
   */
  connecting: boolean
  /** 被房主拒掉的原因；空串表示没被拒过。界面据此决定要不要自动重连。 */
  refused: string
  /** 房间里最近的话；中途进来的人也看得到上一段。 */
  messages: PartyMessage[]
  error: string
}

/** 一起听：局域网房间。状态由主进程推，命令往下发。 */
export interface PartyApi {
  host(name: string, port?: number): Promise<PartyState>
  /** 加入别人的房间；`pass` 是房间口令，没设密码时留空。 */
  join(address: string, code: string, name: string, pass?: string): Promise<PartyState>
  leave(): Promise<PartyState>
  pushNow(now: PartyNow): Promise<PartyState>
  chat(text: string): Promise<PartyState>
  /** 房主填公网地址；客人调用无效果。 */
  setPublic(address: string): Promise<PartyState>
  /** 房主给房间改名；客人调用无效果。 */
  rename(name: string): Promise<PartyState>
  /** 房主给房间上锁或解锁（空串即解锁）；客人调用无效果。 */
  setPassword(password: string): Promise<PartyState>
  /** 房主把随机房间码改成自己好念的一串；客人调用无效果。 */
  setCode(code: string): Promise<PartyState>
  /**
   * 只凭房间码，在同一个局域网里找这间房。
   *
   * 找不到（防火墙、跨网络、房间没开）返回 null，界面退回让房主发地址。
   */
  discover(code: string): Promise<{ address: string; name: string; locked: boolean } | null>
  /** 房主把某个成员请出房间；客人调用无效果。 */
  kick(id: string): Promise<PartyState>
  /**
   * 有人点了邀请链接（`aurora://join?…`）时回调。
   *
   * 主进程只把那条链接原样递过来，解析在渲染层做——两边各写一套解析规则，
   * 迟早出现「主进程认、页面不认」。
   */
  onInvite(listener: (link: string) => void): () => void
  /** 房主把当前这首的播放地址交给房间转发，返回地址里用的令牌。 */
  registerStream(trackId: string, url: string): Promise<string>
  /** 房主开关转发；客人调用无效果。 */
  setRelay(relay: boolean): Promise<PartyState>
  /** 打开聊天室页（单例窗口）。 */
  openChat(): Promise<boolean>
  /** 找 frpc 并验一次能不能跑。 */
  sakuraFrpc(): Promise<{ path: string; ok: boolean; message: string }>
  /** 从樱花官方下载站装一份 frpc 到本机。 */
  sakuraInstallFrpc(): Promise<{ ok: boolean; message: string; path: string }>
  /** 登录樱花：开一扇内嵌登录窗，登录后自动带回访问密钥。 */
  sakuraLogin(): Promise<{ ok: boolean; token: string; message: string }>
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
  /** 删一条隧道（樱花面板里也会一起消失）。 */
  sakuraDelete(token: string, id: number): Promise<{ ok: boolean; message: string }>
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
    tunnels: { id: number; name: string; node: string; type: string; localPort: number; remotePort: number; online: boolean; note: string }[]
    raw: string
  }>
  /** 起樱花隧道（官方独立版 frpc）。 */
  tunnelStart(config: { frpcPath: string; token: string; tunnelId: string }): Promise<TunnelState>
  tunnelStop(): Promise<TunnelState>
  tunnelState(): Promise<TunnelState>
  /** 清空日志面板，不影响隧道本身。 */
  tunnelLogClear(): Promise<TunnelState>
  onTunnel(listener: (state: TunnelState) => void): () => void
  /**
   * Cloudflare 快速隧道。
   *
   * 不需要账号或备案：把房间端口挂到 `wss://<随机名>.trycloudflare.com`，
   * 给樱花节点回 503/501 时留一条能走的公网通道。地址随进程变。
   */
  cloudflare: {
    start(port?: number): Promise<TunnelState>
    stop(): Promise<TunnelState>
    state(): Promise<TunnelState>
    onState(listener: (state: TunnelState) => void): () => void
  }
  state(): Promise<PartyState>
  onState(listener: (state: PartyState) => void): () => void
}

