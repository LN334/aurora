import type { Track } from '../../types'

/**
 * 一起听里跨端传的那一份「这首歌是什么」。
 *
 * 房间同步的本来是 id，客人得自己队列里有同一首才放得了。带上这份描述之后，
 * 房主换到一首客人根本没有的歌，客人也能就地把它装进队列——本地文件不传
 * （客人机器上没有那个文件），只传在线曲。
 */
interface PartyTrackInfo {
  id: string
  source: string
  title: string
  artist: string
  album: string
  duration: number
  coverUrl: string | null
  hasArt: boolean
}

/** 在线曲才值得传；本机文件在对面不存在。 */
export function partyTrackInfoOf(track: Track): PartyTrackInfo | null {
  if (!track.source || track.source === 'local') return null
  return {
    id: track.id,
    source: track.source,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    coverUrl: track.coverUrl ?? null,
    hasArt: Boolean(track.hasArt)
  }
}

/**
 * 把传过来的描述装回一个能播的 Track。
 *
 * 只填这首在线曲真正用得到的字段：id 与 path 都取 id（引擎靠 path 判断「是不是
 * 同一首」，取一个会过期的地址会让每次重放都像换了歌）。其余本机文件元数据给
 * 中性值，界面不会因此少显示什么。
 */
export function trackFromParty(info: PartyTrackInfo): Track {
  return {
    id: info.id,
    path: info.id,
    source: info.source,
    title: info.title,
    artist: info.artist,
    albumArtist: info.artist,
    album: info.album,
    genre: '',
    year: null,
    trackNo: null,
    discNo: null,
    duration: info.duration,
    bitrate: null,
    sampleRate: null,
    channels: 2,
    codec: 'mp3',
    lossless: false,
    size: 0,
    mtimeMs: 0,
    addedAt: Date.now(),
    hasArt: info.hasArt,
    coverUrl: info.coverUrl ?? undefined,
    gainDb: null,
    peak: null
  }
}
