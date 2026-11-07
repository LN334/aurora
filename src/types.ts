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
