/**
 * 在线平台（网易云、QQ、酷狗、B 站、汽水）与评论的类型面。
 *
 * 从 `env.d.ts` 按声明块整体搬出来：那一份把应用侧、播放、一起听与五个平台
 * 全塞在一千六百多行里，找东西只能靠搜索。
 */
/** Why a track cannot play. Drives the message; never collapse these into "下架". */
export type NeteaseFailureReason =
  | 'login-required'
  | 'vip-required'
  | 'region-limited'
  | 'trial-only'
  | 'taken-down'
  | 'network'
  | 'rate-limited'
  | 'service-unavailable'
  | 'unknown'

export interface NeteaseArtist {
  id: number
  name: string
}

export interface NeteaseAlbumRef {
  id: number
  name: string
  picUrl: string | null
}

export interface NeteaseSong {
  id: number
  name: string
  artists: NeteaseArtist[]
  album: NeteaseAlbumRef
  /** Seconds. Upstream reports milliseconds. */
  duration: number
  /** Upstream `fee`: 0 free, 1 vip, 8 low-quality free, 4 paid album. */
  fee: number
}

/**
 * 网易云音质：前四档是老的普通/较高/极高/无损，后四档是无损之上的 Hi-Res 与
 * 空间音频/母带规格（jyeffect 高清环绕、sky 沉浸环绕、jymaster 超清母带）。
 */
export type NeteaseQuality =
  | 'standard'
  | 'higher'
  | 'exhigh'
  | 'lossless'
  | 'hires'
  | 'jyeffect'
  | 'sky'
  | 'jymaster'

export interface NeteaseStream {
  /** Upstream http(s) URL. The renderer must proxy it, not fetch it. */
  url: string
  /** kbps */
  br: number
  level: NeteaseQuality | 'hires'
  /** Seconds of what this URL actually delivers (a trial is shorter). */
  duration: number
  trial: boolean
  trialFrom?: number
  trialTo?: number
}

export type NeteaseStreamResult =
  | { ok: true; stream: NeteaseStream }
  | { ok: false; reason: NeteaseFailureReason; message?: string }

export interface NeteasePlaylistSummary {
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  playCount: number
  creator: string
  subscribed: boolean
}

/** 发现页三个板块的标识。 */
export type NeteaseDiscoverKind = 'newsongs' | 'playlists' | 'quality'

/**
 * 发现页的一张歌单卡片。
 *
 * 与 `NeteasePlaylistSummary` 分开：那个是「我拥有的歌单」，带 `subscribed`；
 * 推荐的歌单没有归属，带的是上游一句话推荐语。
 */
export interface NeteaseDiscoverPlaylist {
  id: number
  name: string
  coverUrl: string | null
  trackCount: number
  playCount: number
  creator: string
  note: string
}

/** 发现页一个板块的结果；两个列表只会有一个非空。 */
export interface NeteaseDiscoverResult {
  kind: NeteaseDiscoverKind
  songs: NeteaseSong[]
  playlists: NeteaseDiscoverPlaylist[]
}

export interface NeteaseAccount {
  userId: number
  nickname: string
  avatarUrl: string | null
  vip: boolean
  level: number
}

/**
 * 一条在线评论。
 *
 * 四个平台的字段名与嵌套都不同，主进程已经把它们压成这一种形状：页面不需要
 * 知道「酷狗的赞是 like.count 还是 praise_count」。`time` 是秒级 Unix 时间；
 * 没有时间戳的评论给 null，页面就不画时间——比编一个「刚刚」诚实。
 */
export interface OnlineComment {
  id: string
  author: string
  avatar: string | null
  text: string
  likes: number
  replies: number
  time: number | null
  featured: boolean
}

/** 一页评论，外加继续翻页要用的游标。 */
export interface CommentPage {
  comments: OnlineComment[]
  total: number | null
  hasMore: boolean
  /** 不透明的翻页键；酷狗是页码，其余是偏移量或上游游标。空串表示没有下一页。 */
  cursor: string
}

/**
 * 写评论的结果。
 *
 * 写不像读：读失败可以安静地退回空页，写失败得让用户知道为什么。`message`
 * 是给界面直接画的一句人话（「登录网易云后才能发评论」「最多 140 字」），
 * 成功时为空串。
 */
export interface CommentWriteResult {
  ok: boolean
  message: string
}


export interface NeteaseSearchResult {
  songs: NeteaseSong[]
  albums: {
    id: number
    name: string
    artist: string
    picUrl: string | null
    year: number | null
    songCount: number
  }[]
  artists: { id: number; name: string; picUrl: string | null; albumCount: number }[]
}

export interface NeteaseApi {
  /**
   * Bind subsequent calls to a profile.
   *
   * An online account belongs to one profile: switching profiles switches whose
   * Netease session is in use, the same way it switches which local library is
   * open. Without this the app had a single machine-wide session, so every
   * profile saw the same online playlists while the README promised that
   * switching profiles changes your playlists.
   */
  setProfile(profileId: string): Promise<boolean>
  /** Which account a profile is signed in as, or null. Used by the profiles screen. */
  accountFor(profileId: string): Promise<NeteaseAccount | null>
  logoutProfile(profileId: string): Promise<boolean>

  /** Upstream self-check: whether the client bootstrapped and whether a cookie exists. */
  status(): Promise<{ ready: boolean; loggedIn: boolean; detail?: string }>

  search(
    keywords: string,
    type: 'song' | 'album' | 'artist',
    limit?: number
  ): Promise<NeteaseSearchResult>

  /** Resolve a playable URL. Failures are classified, not thrown. */
  streamUrl(songId: number, quality?: NeteaseQuality): Promise<NeteaseStreamResult>

  lyrics(songId: number): Promise<{ lrc: string | null; translation: string | null } | null>

  /** 一页评论；翻页把上一页末尾的 cursor 带回来。未登录也能读。 */
  comments(songId: number, cursor?: string, limit?: number): Promise<CommentPage | null>

  /** 发一条评论。要登录；失败时 message 说明原因。 */
  commentSend(songId: number, content: string): Promise<CommentWriteResult>
  /** 赞 / 取消赞一条评论。要登录。 */
  commentLike(songId: number, commentId: number, liked: boolean): Promise<CommentWriteResult>

  album(id: number): Promise<{
    id: number
    name: string
    artist: string
    artistId: number | null
    coverUrl: string | null
    year: number | null
    /** 专辑简介，没有就是空串。 */
    description: string
    songs: NeteaseSong[]
  } | null>

  artistTopSongs(id: number, limit?: number): Promise<NeteaseSong[]>
  artistDetail(id: number): Promise<{
    id: number
    name: string
    coverUrl: string | null
    briefDesc: string
    albumCount: number
    songCount: number
  } | null>
  artistSongs(id: number, limit?: number, offset?: number): Promise<NeteaseSong[]>
  artistAlbums(
    id: number,
    limit?: number,
    offset?: number
  ): Promise<{ id: number; name: string; coverUrl: string | null; year: number | null; songCount: number }[]>
  songDetail(ids: number[]): Promise<NeteaseSong[]>

  qrCreate(): Promise<{ key: string; url: string; imageDataUrl: string }>
  qrCheck(key: string): Promise<{
    status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
    account?: NeteaseAccount
    message?: string
  }>
  loginCellphone(
    phone: string,
    password: string
  ): Promise<{ ok: boolean; account?: NeteaseAccount; message?: string }>
  loginStatus(): Promise<NeteaseAccount | null>
  logout(): Promise<boolean>

  /**
   * 发现页的公开内容：不需要登录，匿名 cookie 就够。
   *
   * 可选：浏览器预览与部分构建没有主进程的这条通道，页面据此显示空态而不是
   * 每个操作都报一次网络错误。`bridge.ts` 的回退对象没有实现它。
   */
  discover?(
    kind: NeteaseDiscoverKind,
    limit?: number,
    offset?: number
  ): Promise<NeteaseDiscoverResult>

  /** Personal music. Empty arrays (not errors) when signed out. */
  myPlaylists(): Promise<NeteasePlaylistSummary[]>
  /** 收藏的专辑；未登录返回空数组。 */
  albumSublist(): Promise<
    { id: number; name: string; coverUrl: string | null; artistName: string; artistId: number; year: number; songCount: number }[]
  >
  /** 关注的艺人；未登录返回空数组。 */
  artistSublist(): Promise<
    { id: number; name: string; avatarUrl: string | null; albumCount: number; musicCount: number }[]
  >
  topAlbums(limit?: number, offset?: number): Promise<
    { id: number; name: string; coverUrl: string | null; artistName: string; artistId: number; year: number; songCount: number }[]
  >
  playlistTracks(id: number): Promise<NeteaseSong[]>
  /** 歌单创建者；推荐位卡片不带这个字段，详情页缺名字时补问一次。 */
  playlistCreator(id: number): Promise<string>
  dailySongs(): Promise<NeteaseSong[]>
  /** 私人漫游：一次几首没听过的，播到队尾再要下一批。 */
  personalFm(limit?: number): Promise<NeteaseSong[]>
  cloudSongs(): Promise<NeteaseSong[]>
  likeList(): Promise<NeteaseSong[]>
  /** 喜欢/取消喜欢一首歌；未登录或上游失败返回 false。 */
  like(songId: number, liked: boolean): Promise<boolean>

  /**
   * 自己建的歌单的五处写：建、加减歌、改名、删单。
   *
   * 与读接口同一套失败口径：未登录或上游拒绝时回 false/null，不抛。歌单 id 是
   * 网易云那一侧的，只有「我建的」才写得动——收藏来的别人的歌单上游也会拒。
   */
  playlistCreate(name: string): Promise<{ id: number; name: string } | null>
  playlistAddTracks(id: number, trackIds: number[]): Promise<boolean>
  playlistRemoveTracks(id: number, trackIds: number[]): Promise<boolean>
  playlistRename(id: number, name: string): Promise<boolean>
  playlistDelete(id: number): Promise<boolean>

  getQuality(): Promise<NeteaseQuality>
  setQuality(quality: NeteaseQuality): Promise<NeteaseQuality>
}

// --- QQ 音乐（第三方逆向接口）---------------------------------------------
//
// 与网易云并列的第二个在线平台，走另一套第三方接口。与网易云不同，这里不直接
// require 那个包的函数：`@yakult-green-tea/qq-music-api` 是个 Koa 服务，主进程
// 在 `electron/qq/local-server.ts` 里把它起在 127.0.0.1 的随机端口上，
// `electron/qq/transport.ts` 再用 HTTP 调它。
// 这里刻意与 Netease 保持同一套词汇：失败原因复用 `NeteaseFailureReason`，音质复用
// 同一个四档，播放结果同样是「成功给地址、失败给原因」而不是抛错。
//
// 两处不一样，都来自上游本身：
//   * 歌曲身份是 `songmid`（字符串），不是数字。数字 `songid` 只够查歌词，播放路由
//     用它会得到 `result=101404`（实测），所以 `id`（数字，给共享形状用）与
//     `songmid`/`mid`（字符串，播放身份）同时给出。
//   * 拒绝是**常态**：主流热歌都要会员，拿不到地址时给的是原因，不是错误。

/** 复用网易云的原因词汇；两个平台在界面上共用同一套文案。 */
export type QqFailureReason = NeteaseFailureReason

/** 与网易云同一套音质档位（`src/features/online/types.ts` 的 `QualityTier`）。 */
export type QqQuality = NeteaseQuality

export interface QqArtist {
  /** 数字 `singerID`。 */
  id: number
  /** `singerMID`。 */
  mid: string
  name: string
}

export interface QqAlbumRef {
  /** 数字 `albumID`。 */
  id: number
  /** `albumMID`，封面地址由它拼出。 */
  mid: string
  name: string
  picUrl: string | null
}

export interface QqSong {
  /** 数字 `songid`，供共享歌曲形状使用。 */
  id: number
  songId: number
  /** 播放身份；`streamUrl` 接受它或数字 id。 */
  songmid: string
  /** `songmid` 的别名，共享形状声明的 `mid` 字段。 */
  mid: string
  mediaMid: string
  name: string
  artists: QqArtist[]
  album: QqAlbumRef
  /** 秒。 */
  duration: number
  /** 目录里的付费提示（`pay.payplay`）：1 表示标价，**不是**不可播的判决。 */
  fee: number
  paid: boolean
}

/** 与 Netease 不同：QQ 的结果是扁平的，`url`/`br`/`level` 都在顶层。 */
export type QqStreamResult =
  | {
      ok: true
      url: string
      /** 请求的档位。 */
      quality: QqQuality
      /** 实际拿到的档位（可能因账号权限更低）。 */
      level: QqQuality
      /** kbps；999 是本项目表示无损的既有约定。 */
      br: number
      lossless: boolean
      trial: boolean
    }
  | { ok: false; reason: QqFailureReason; message?: string }

export interface QqSearchResult {
  songs: QqSong[]
  /**
   * 上游没有专辑搜索：这些来自「你是不是要找」的单张专辑，以及匹配到的歌手的专辑列表。
   * 所以这个数组可能很短，甚至为空——这是上游的能力边界，不是失败。
   */
  albums: {
    id: number
    name: string
    artist: string
    picUrl: string | null
    year: number | null
    songCount: number
  }[]
  /** 同上：最多是上游为这次查询匹配到的那一位歌手。 */
  artists: { id: number; name: string; picUrl: string | null; albumCount: number }[]
}

export interface QqAccount {
  /** 数字 uin。 */
  id: number
  nickname: string
  avatarUrl: string | null
  /**
   * `null` 表示「没探到」，不是「不是会员」。探测失败时主进程保留上一次的结论，
   * 免得一次网络抖动就让付费用户以为会员失效了。
   */
  vip: boolean | null
  level: number
}

export interface QqApi {
  /** 把后续调用绑定到某个档案（会话与音质偏好都是按档案存的）。 */
  setProfile(profileId: string): Promise<boolean>
  accountFor(profileId: string): Promise<QqAccount | null>
  logoutProfile(profileId: string): Promise<boolean>

  status(): Promise<{ ready: boolean; loggedIn: boolean; detail?: string }>

  search(
    keywords: string,
    type: 'song' | 'album' | 'artist',
    limit?: number
  ): Promise<QqSearchResult>

  streamUrl(songId: string | number, quality?: QqQuality): Promise<QqStreamResult>

  /** 正文与译文各一份 LRC；两份时间轴由渲染层对齐。没有歌词时 null。 */
  lyrics(songId: string | number): Promise<{ lrc: string | null; translation: string | null } | null>

  /** 一页评论。评论区认数字 songid，不是 songmid。 */
  comments(songId: string | number, cursor?: string, limit?: number): Promise<CommentPage | null>

  /** 发一条评论。同样是数字 songid。 */
  commentSend(songId: string | number, content: string): Promise<CommentWriteResult>

  qrCreate(): Promise<{ key: string; imageDataUrl: string }>
  qrCheck(key: string): Promise<{
    status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
    account?: QqAccount
    message?: string
  }>
  loginStatus(): Promise<QqAccount | null>
  logout(): Promise<boolean>

  getQuality(): Promise<QqQuality>
  setQuality(quality: QqQuality): Promise<QqQuality>

  /** 当前档案自己的歌单（需要登录；未登录返回空数组）。 */
  myPlaylists(limit?: number): Promise<QqPlaylistSummary[]>
  /** 公开推荐歌单（首页「歌单」横排用）；不需要账号。 */
  recommendPlaylists(limit?: number): Promise<QqPlaylistSummary[]>
  /** 一个歌单里的歌。 */
  playlistTracks(id: string | number): Promise<QqSong[]>
  /** 歌单作者。列表里不带，打开详情时补问。 */
  playlistCreator(id: number): Promise<string>
  /** 每日推荐。 */
  /** 新歌速递；不需要登录。 */
  newSongs(limit?: number): Promise<QqSong[]>
  daily(): Promise<QqSong[]>
  /** 我喜欢的音乐。 */
  liked(): Promise<QqSong[]>
  /**
   * 点/取消红心，直接写回 QQ 音乐账号。
   *
   * true 才代表上游那侧真的变成想要的态——主进程先读一次、再写、再读回来核对；
   * 没登录、不知道 mid、上游拒了、读不回来，一律 false（界面提示「没写成」）。
   */
  like(songId: number, liked: boolean): Promise<boolean>
  /**
   * 自己建的歌单（id 是 tid / dissid，与列表里那张卡的 id 一致）。
   *
   * 只列自建；「我喜欢」这类系统目录不在其中。未登录返回空数组。
   */
  playlistOwned(): Promise<{ id: number; name: string }[]>
  /** 新建歌单。未登录或上游拒了回 null。 */
  playlistCreate(name: string): Promise<{ id: number; name: string } | null>
  playlistDelete(id: number): Promise<boolean>
  playlistRename(id: number, name: string): Promise<boolean>
  /** 加（add=true）/ 删（add=false）歌。写完主进程读回核对，false 表示没成。 */
  playlistTracksEdit(id: number, songIds: number[], add: boolean): Promise<boolean>
  /** 收藏的专辑（需要登录；未登录返回空数组）。 */
  collectedAlbums(limit?: number): Promise<QqCollectedAlbum[]>
  /**
   * 关注的歌手（需要登录；未登录或登录过期都返回空数组）。
   *
   * 上游只保证 id 与名字，封面和两个计数是「有就带上」——页面要按「没有封面」
   * 与 0 处理。
   */
  followedArtists(limit?: number): Promise<QqFollowedArtist[]>
  /**
   * 一张专辑：抬头 + 曲目。
   *
   * QQ 的专辑详情只认 albummid，而页面按数字 id 寻址；主进程会从最近读过的
   * 列表里把 mid 找出来。没见过的 id 返回 null，不猜一个。
   */
  album(id: number): Promise<{ detail: QqAlbumDetail; songs: QqSong[] } | null>
}

/** 收藏专辑的一行。列表接口比详情接口短：没有简介和厂牌，但封面已经是成品地址。 */
export interface QqCollectedAlbum {
  id: number
  mid: string
  name: string
  coverUrl: string | null
  artistName: string
  artistMid: string | null
  year: number | null
  songCount: number
}

/** 关注歌手的一行。QQ 这边只有 id 与名字是稳的。 */
export interface QqFollowedArtist {
  id: number
  mid: string
  name: string
  avatarUrl: string | null
  albumCount: number
  musicCount: number
}

/** 一张 QQ 专辑的抬头。 */
export interface QqAlbumDetail {
  id: number
  mid: string
  name: string
  coverUrl: string | null
  artistName: string
  artistMid: string | null
  year: number | null
  trackCount: number
  description: string
}

/**
 * QQ 音乐里「我的歌单」的一行。
 *
 * 只有列表要用的字段：封面、名字、首数。歌单内容另外取——上游一次只给一份，
 * 而用户多数时候不会把它们全点开。
 */
export interface QqPlaylistSummary {
  /** `dissid`，详情接口按它取。 */
  id: number
  name: string
  /** 上游有时不给封面，所以这里可以是 null。 */
  coverUrl: string | null
  /** `song_cnt`；0 表示上游没报，不是「空歌单」。 */
  trackCount: number
  creator: string
}

// --- 酷狗音乐（第三方逆向接口 + 本地 vendor 服务）---------------------------
//
// 第三个在线平台，和 QQ 最大的不同在**部署形态**：上游不是一个能从主进程
// `require` 的 SDK，而是一个本地 Node 服务（`vendor/KuGouMusicApi`）。主进程
// 负责把它拉起来、等它就绪、随应用退出关掉；渲染层只看见「有/没有」，看不见
// 端口和进程。
//
// 沿用同一套词汇：失败原因复用 `NeteaseFailureReason`，音质复用同一个四档。
//
// 两处来自上游的事实，直接写进形状里：
//   * 播放身份不是数字。取流要 `hash` + `albumId` + `albumAudioId` 三个字符串，
//     所以 `KugouSong` 三样都带上，`id` 只是共享界面要的数字钥匙。
//   * 歌单身份是字符串 `global_collection_id`，而共享界面按正整数取歌单，所以
//     `KugouPlaylistSummary.id` 是主进程在本次会话里发的稳定数字别名。

/** 复用网易云的原因词汇；界面上三个平台共用一套文案。 */
export type KugouFailureReason = NeteaseFailureReason

/** 与网易云同一套音质档位。 */
export type KugouQuality = NeteaseQuality

export interface KugouArtist {
  id: number
  name: string
  avatar: string | null
}

export interface KugouAlbumRef {
  /** 上游是字符串（`AlbumID` / `albuminfo.id`）。 */
  id: string
  name: string
  picUrl: string | null
}

/**
 * 一首酷狗歌曲。
 *
 * 三个 hash 是三种音质：128k、320k、无损。上游对没有的档位给空串，所以这里
 * 也是空串而不是 null——"没有这一档"与"这一档不可用"在客户端是同一件事。
 */
export interface KugouSong {
  /** 数字钥匙，共享界面用它索引；真正的身份在下面几个字符串里。 */
  id: number
  /** 上游 `FileHash`（128k）。 */
  hash: string
  hqHash: string
  sqHash: string
  /** 上游 `MixSongID`，取流要的 `album_audio_id`。 */
  albumAudioId: string
  albumId: string
  name: string
  artists: KugouArtist[]
  album: KugouAlbumRef
  /** 秒。上游是毫秒（`timelen`）时客户端已经换算过。 */
  duration: number
  /** 0 免费、1 会员、4 付费专辑……与 QQ/网易云同一个词汇。 */
  fee: number
  /** 上游明确说了「要付费」时为 true。 */
  paid: boolean
}

export type KugouStreamResult =
  | {
      ok: true
      url: string
      /** 请求的档位。 */
      quality: KugouQuality
      /** 实际拿到的档位，可能低于请求。 */
      level: KugouQuality
      br: number
      lossless: boolean
      trial: boolean
    }
  | { ok: false; reason: KugouFailureReason; message?: string }

export interface KugouSearchResult {
  songs: KugouSong[]
  /** 上游只有歌曲搜索，这两个恒为空数组（形状存在是为了共享读取器）。 */
  albums: KugouAlbumRef[]
  artists: KugouArtist[]
}

export interface KugouAccount {
  id: number
  nickname: string
  avatarUrl: string | null
  /** 有没有会员；null 是「上游没给」，不是「没有」。 */
  vip: boolean | null
}

export interface KugouStatusResult {
  ready: boolean
  loggedIn: boolean
  detail?: string
}

/** 待扫的二维码。`key` 是不透明句柄，轮询用它；上游的 `qrcode` 留在主进程。 */
export interface KugouQrSession {
  key: string
  imageDataUrl: string
}

export interface KugouQrResult {
  status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
  account?: KugouAccount
  message?: string
}

/**
 * 酷狗里「歌单」的一行。
 *
 * `id` 是主进程发的数字别名（上游 `global_collection_id` 是字符串，而共享界面
 * 按正整数取歌单）。别名在本次会话里稳定，重开应用后重新取一次列表即可。
 */
/** 一张专辑的头部；曲目在 `KugouAlbumBundle.songs` 里。 */
export interface KugouAlbumDetail {
  id: number
  name: string
  artist: string
  picUrl: string | null
  year: number | null
  /** 专辑简介；上游没写就是空串。 */
  intro: string
  /** 曲目数由曲目接口的 total 补；0 表示没问到。 */
  songCount: number
}

export interface KugouAlbumBundle {
  detail: KugouAlbumDetail
  songs: KugouSong[]
}

/** 一个艺人的头部。三个数字都是上游自己报的，不是估算。 */
export interface KugouArtistDetail {
  id: number
  name: string
  picUrl: string | null
  albumCount: number
  songCount: number
  fans: number
  intro: string
}

/** 专辑列表的一行：与共享的 `OnlineAlbumRef` 同形。 */
export interface KugouAlbumEntry {
  id: number
  name: string
  artist: string
  picUrl: string | null
  year: number | null
  songCount: number
}

export interface KugouPlaylistSummary {
  id: number
  name: string
  coverUrl: string | null
  /** 上游 `count`；0 表示没报，不是「空歌单」。 */
  trackCount: number
  creator: string
}

/**
 * 酷狗的桥。
 *
 * 与 QQ 同一套方法名，少一个（没有歌词），多出来的 `playlistTracks`/`album`/`artist`
 * 接受数字别名。`streamUrl` 的入参是数字钥匙或字符串上游 id。
 */
export interface KugouApi {
  setProfile(profileId: string): Promise<boolean>
  accountFor(profileId: string): Promise<KugouAccount | null>
  logoutProfile(profileId: string): Promise<boolean>

  status(): Promise<KugouStatusResult>
  search(keywords: string, type?: string, limit?: number): Promise<KugouSearchResult>
  /** 取播放地址。未登录、需要会员、上游拒绝都按原因作答，不抛错。 */
  streamUrl(songId: string | number, quality?: KugouQuality): Promise<KugouStreamResult>
  /**
   * 歌词：正文与译文分成两份 LRC 交回，时间戳同源。
   * 上游没有歌词、本地没记过这首歌时都是 null，不抛错。
   */
  lyrics(songId: string | number): Promise<{ lrc: string; translation: string } | null>

  /** 一页评论。要「见过这首歌」——评论挂在 mixsongid 上，得先在索引里。 */
  comments(songId: string | number, cursor?: string, limit?: number): Promise<CommentPage | null>

  /** 发一条评论。要登录；写接口的签名由本地 vendor 负责。 */
  commentSend(songId: string | number, content: string): Promise<CommentWriteResult>

  qrCreate(): Promise<KugouQrSession>
  qrCheck(key: string): Promise<KugouQrResult>
  loginStatus(): Promise<KugouAccount | null>
  logout(): Promise<boolean>

  getQuality(): Promise<KugouQuality>
  setQuality(quality: KugouQuality): Promise<KugouQuality>

  /** 当前档案的歌单；未登录时是公开榜单，读不到就是空数组。 */
  myPlaylists(limit?: number): Promise<KugouPlaylistSummary[]>
  /** 公开推荐歌单（首页「歌单」横排用）；不需要账号。 */
  recommendPlaylists(limit?: number): Promise<KugouPlaylistSummary[]>
  /** 新歌速递；不需要登录。 */
  newSongs(limit?: number): Promise<KugouSong[]>
  /** 一张歌单里的歌。`id` 是列表里那个数字别名。 */
  playlistTracks(id: string | number): Promise<KugouSong[]>
  /** 歌单作者；同样是数字别名。 */
  playlistCreator(id: number): Promise<string>
  /** 「我喜欢」。酷狗没有独立接口，读的就是那张云端歌单。 */
  likes(limit?: number): Promise<KugouSong[]>
  /**
   * 点红心 / 取消。酷狗这边等于把歌加进「我喜欢」歌单或从里面删掉，
   * 主进程写完会读回核对，true 才代表上游真的变了。
   */
  like(songId: number, liked: boolean): Promise<boolean>

  /** 一张专辑的头部 + 曲目；查不到时 null（不是空对象）。 */
  album(id: number): Promise<KugouAlbumBundle | null>
  /** 一个艺人的头部。 */
  artist(id: number): Promise<KugouArtistDetail | null>
  /** 艺人页「全部歌曲」，按热度排。 */
  artistSongs(id: number, limit?: number, offset?: number): Promise<KugouSong[]>
  /** 艺人页「专辑」。 */
  artistAlbums(id: number, limit?: number, offset?: number): Promise<KugouAlbumEntry[]>
  /** 每日推荐 30 首；不需要登录。 */
  dailyRecommend(): Promise<KugouSong[]>
  /** 我关注的歌手。酷狗把关注对象混在一个列表里，主进程只挑出歌手。 */
  followedArtists(): Promise<KugouFollowedArtist[]>
}

/** 酷狗「我关注的歌手」。没有专辑数/歌曲数，字段就是上游给的三样。 */
interface KugouFollowedArtist {
  id: string
  name: string
  avatarUrl: string | null
}

// --- 汽水音乐（抖音，第三方逆向接口 + npm SDK）-------------------------------
//
// 第四个在线平台，部署形态最简单也最特别：没有本地服务，全部请求由主进程
// require('qishui-music-api') 直接发出。
//
// 两处来自上游的事实，直接写进形状里：
//   * 所有 id 都是 19 位十进制字符串，超过 JS 安全整数。共享界面按数字取 id，
//     所以主进程发数字别名（userData/qishui-refs.json 里存双向表），原始字符串放 mid。
//   * 音质分四档但与另外三家不同名（standard/high/lossless/hires），单独定义。

export type QishuiQuality = 'standard' | 'high' | 'lossless' | 'hires'

/** 复用网易云的原因词汇；界面上四个平台共用一套文案。 */
type QishuiFailureReason = NeteaseFailureReason

interface QishuiArtist {
  id: number
  name: string
}

interface QishuiAlbumRef {
  id: number
  name: string
  picUrl: string | null
}

export interface QishuiSong {
  /** 数字别名，共享界面用它索引；真正的身份在 mid 里。 */
  id: number
  /** 上游原始 id，19 位十进制字符串。 */
  mid: string
  name: string
  artists: QishuiArtist[]
  album: QishuiAlbumRef
  /** 秒。 */
  duration: number
  coverUrl: string | null
}

type QishuiStreamResult =
  | { ok: true; url: string; level: QishuiQuality; br: number; trial: boolean }
  | { ok: false; reason: QishuiFailureReason; message?: string }

interface QishuiSearchResult {
  songs: QishuiSong[]
}

interface QishuiAccount {
  id: string
  nickname: string
  avatarUrl: string | null
}

interface QishuiStatusResult {
  ready: boolean
  loggedIn: boolean
  detail?: string
}

/** 待扫的二维码。key 是不透明句柄，轮询用它。 */
interface QishuiQrSession {
  key: string
  imageDataUrl: string
}

interface QishuiQrResult {
  status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
  account?: QishuiAccount
  message?: string
}

interface QishuiPlaylistSummary {
  id: number
  name: string
  coverUrl: string | null
  /** 上游 track_count；0 表示没报，不是「空歌单」。 */
  trackCount: number
  creator: string
  /** 歌单作者的账号 id；空串表示上游没报。渲染侧拿它和自己的账号 id 比，分自建与收藏。 */
  ownerId: string
}

interface QishuiArtistProfile {
  id: number
  name: string
  coverUrl: string | null
  description: string
  /** 上游 count_tracks；0 表示没报。 */
  trackCount: number
}

/**
 * 汽水的桥。
 *
 * 与另外三个平台同一套词汇，但有两点不同：搜索只有歌曲（上游没有专辑/艺人
 * 搜索），专辑页因此不做；播放地址只有一种真档位（standard），别的高档位
 * 要会员，失败会按 vip-required 答回来。
 */
/**
 * B 站：把视频当歌。没有账号体系，也没有歌词。
 *
 * 音频地址绑定 UA 与 Referer，渲染层拿到 URL 后不能直接塞给 <audio>，要走
 * `aurora-remote:` 代理——和另外四家的在线流是同一条路。
 */
export interface BilibiliVideo {
  aid: number
  bvid: string
  title: string
  author: string
  cover: string | null
  /** 秒。 */
  duration: number
  cid: number
}

export type BilibiliQuality = 'standard' | 'higher' | 'exhigh' | 'lossless' | 'hires'

/** B 站扫码后的账号；未登录时 loginStatus 回 null。 */
interface BilibiliAccount {
  nickname: string
  mid: number
  vip: boolean
  face: string
  level: number
}

export interface BilibiliApi {
  search(keywords: string, limit?: number): Promise<{ videos: BilibiliVideo[] }>
  streamUrl(
    songId: number,
    quality: BilibiliQuality | string
  ): Promise<
    | {
        ok: true
        stream: { url: string; br: number; level: BilibiliQuality; duration: number; trial: boolean }
      }
    | { ok: false; reason: string; message?: string }
  >
  /** 绑档案：登录态按档案分槽存。 */
  setProfile(profileId: string): Promise<boolean>
  loginQr(): Promise<{ key: string; imageDataUrl: string }>
  qrCheck(key: string): Promise<{
    status: 'waiting' | 'scanned' | 'expired' | 'confirmed' | 'failed'
    message?: string
  }>
  loginStatus(): Promise<BilibiliAccount | null>
  logout(): Promise<boolean>
}

export interface QishuiApi {
  setProfile(profileId: string): Promise<boolean>
  status(): Promise<QishuiStatusResult>
  search(keywords: string, limit?: number): Promise<QishuiSearchResult>
  song(id: number): Promise<QishuiSong | null>
  /** 取播放地址。未登录、需要会员、上游拒绝都按原因作答，不抛错。 */
  streamUrl(songId: number, quality?: QishuiQuality): Promise<QishuiStreamResult>
  /** 歌词：正文与译文分成两份 LRC 交回；没有歌词时 null，不抛错。 */
  lyrics(songId: number): Promise<{ lrc: string; translation: string } | null>

  /** 一页评论。读评论不需要登录，也不需要签名。 */
  comments(songId: number, cursor?: string, limit?: number): Promise<CommentPage | null>

  qrCreate(): Promise<QishuiQrSession>
  qrCheck(key: string): Promise<QishuiQrResult>
  loginStatus(): Promise<QishuiAccount | null>
  logout(): Promise<boolean>

  /** 「我喜欢的」。未登录时上游答 auth-required，这里给空数组。 */
  liked(limit?: number): Promise<QishuiSong[]>
  /**
   * 推荐流。与另外几个个性化接口不同，`feed` 游客也能读到——一天一批、一次
   * 最多 30 首，是汽水唯一能进「漫游」的入口。
   */
  feed(limit?: number): Promise<QishuiSong[]>
  /** 收藏／取消收藏。写回平台账号，未登录或上游拒绝回 false。 */
  like(songId: number, liked: boolean): Promise<boolean>
  /**
   * 往自己的歌单里加歌／移出歌。
   *
   * 汽水上游只给了这两个动作，不能新建、改名、删单——所以另外三支没有。
   */
  playlistTracksEdit(playlistId: number, songIds: number[], add: boolean): Promise<boolean>
  /** 公开歌单搜索；首页推荐位用它拿「汽水推荐了什么」，不需要登录。 */
  searchPlaylists(keywords: string, limit?: number): Promise<QishuiPlaylistSummary[]>
  myPlaylists(limit?: number): Promise<QishuiPlaylistSummary[]>
  playlistCreator(id: number): Promise<string>
  /**
   * 这张歌单是不是当前账号自己建的。
   *
   * 列表只给数字 `owner_id`，登录态给的是加密 id，两个域对不上；能比的只有详情里的
   * `relation_info.owner.id`。拿不到任一侧时回 null（分不出来），不要猜。
   */
  playlistOwned(id: number): Promise<boolean | null>
  playlistTracks(id: number): Promise<QishuiSong[]>
  artistProfile(id: number): Promise<QishuiArtistProfile | null>
  artistSongs(artistId: number, limit?: number): Promise<QishuiSong[]>
}

