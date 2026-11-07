/**
 * Domain model. These shapes are shared with the main process over IPC, so
 * they are deliberately plain data - no class instances, no Dates.
 */

export type ViewId =
  /**
   * 发现：平台推荐内容。
   *
   * 一级入口之一。它回答的是「有什么可听的」，所以不属于任何一个平台，
   * 也不属于本机曲库——平台与本地在它里面都是内容的来源。
   */
  | 'discover'
  /**
   * 音乐库：来源（本机 / 各在线平台）+ 栏目。
   *
   * 一级入口之一。本地文件与在线平台在这里是平级的来源标签页，而不是
   * 侧栏里两组并列的入口——那正是「本地音乐分类太怪」的由来。
   * 专辑/艺术家/歌单的详情页仍是独立视图，因为它们有自己的返回与历史。
   */
  | 'library'
  /**
   * 收藏：用户自己的东西（我喜欢的歌曲、我建的歌单）。
   *
   * 一级入口之一。它和音乐库的区别是：音乐库描述磁盘上有什么（文件决定栏目），
   * 收藏描述「我挑过什么」——同一首歌可能来自任何来源，也可能一条文件都没有。
   * 歌单也归这里：一首歌进歌单靠的是人，不是它存在哪个文件夹。
   */
  | 'collection'
  | 'albums'
  | 'artists'
  | 'songs'
  | 'folders'
  | 'playlists'
  | 'accounts'
  | 'sources'
  | 'settings'
  /**
   * One route per online platform, named by the platform's own id.
   *
   * The screen those routes reach is shared (`features/online/PlatformView.tsx`);
   * what differs is which provider it is handed. The values are written out rather
   * than derived from the provider registry because a route is one of the few
   * things that genuinely is a fixed part of the shell - the fragment in the URL,
   * the page title and the history entry all have to be static.
   */
  | 'netease'
  | 'qq'
  /**
   * Search, as a screen rather than a behaviour of whichever page is open.
   *
   * It answers from whichever catalogue its tabs name, which is why it is its own
   * view: the field in the shell now means one thing everywhere, and "which
   * source" is chosen visibly instead of being implied by the page.
   */
  | 'search'


export interface Track {
  /** Stable hash of the file path; survives re-scans and library moves. */
  id: string
  path: string
  /**
   * Which `TrackSource` owns this track. Absent means the local library, which
   * is why adding a remote source never touches existing code paths.
   */
  source?: string
  title: string
  artist: string
  /** Falls back to `artist` when the tag is absent, so grouping never breaks. */
  albumArtist: string
  album: string
  genre: string
  year: number | null
  trackNo: number | null
  discNo: number | null
  /** Seconds. */
  duration: number
  bitrate: number | null
  sampleRate: number | null
  channels: number | null
  codec: string
  lossless: boolean
  size: number
  /** File mtime, used to skip unchanged files on a re-scan. */
  mtimeMs: number
  addedAt: number
  /**
   * Whether artwork is expected to exist.
   *
   * Optimistic: the scanner does not decode embedded pictures (that would cost
   * a Buffer per file), so this is "assume yes" and the artwork request decides
   * for real. Renderers must fall back to a placeholder on load failure.
   */
  hasArt: boolean
  /**
   * Upstream cover address, for sources that do not serve artwork by track id.
   *
   * Kept on the track itself rather than in a side cache because history and
   * restored queues outlive any process: a cache dies with the window and the
   * same song comes back without a cover on the next launch.
   */
  coverUrl?: string
  /**
   * The upstream album / artist this row came from, when the source reports them.
   *
   * Kept as numbers (the platforms' own ids) so a row can jump to that album or
   * artist page without re-searching by name — names collide, ids do not.
   */
  albumId?: number
  artistId?: number
  /**
   * 该平台自己的数字歌曲 id。
   *
   * 各平台的取流接口都按数字 id 认歌，而 QQ 的曲目 id 是 qq:<songmid>（字母
   * 串）。把数字 id 一并带在行上，播放器取流时不必再反解字符串，也不必知道
   * 是哪一个平台。
   */
  onlineId?: number
  /** 专辑 / 艺人的平台字符串 id；QQ 只认 mid，不认数字 id。 */
  albumMid?: string
  artistMid?: string
  /**
   * 这一行的所有艺人，各自带平台 id。
   *
   * 一行可能挂着三个歌手（"周乘羽 / 卡力老虎 / Matt吕彦良"），那是三张
   * 艺人页，不是一个叫这串字的艺人。名字拼在一起只够看，不够点——所以要
   * 逐个留着 id，列表才做得到「点谁去谁那儿」。
   */
  artistRefs?: { id: number; name: string }[]
  /**
   * 同一首歌在其它平台上的版本。
   *
   * 多平台统一列表把重复的合并成一行，主行是优先级最高的那个版本，其余版本
   * 挂在这里。播放时按用户设定的音源顺序从中挑第一个能出流的。
   */
  versions?: Track[]
  /** ReplayGain, when the tags carry it. */
  gainDb: number | null
  peak: number | null
}

export interface Album {
  /** `albumArtist\u0000album` - the natural key for a release. */
  id: string
  name: string
  albumArtist: string
  year: number | null
  trackIds: string[]
  duration: number
  hasArt: boolean
}

export interface Artist {
  id: string
  name: string
  albumIds: string[]
  trackCount: number
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}

export interface LibraryIndex {
  version: number
  scannedAt: number
  roots: string[]
  tracks: Track[]
}

export type RepeatMode = 'off' | 'all' | 'one'
