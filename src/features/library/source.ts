import { isNative } from '../../bridge'
import { mergeTranslation } from '../netease/lrc'
import { netease, hasNeteaseBackend } from '../netease/api'
import { streamOf } from '../netease/store'
import { neteaseSongId } from '../netease/track'
import { artUrl, mediaUrl, remoteImageUrl, remoteStreamUrl } from '../player/urls'
import { cachedStream } from '../online/streams'
import type { Track } from '../../types'
import { demoCoverFor, demoLyricsFor } from './demo'

/**
 * The library-source seam.
 *
 * Everything that answers "where does this track's audio, artwork and lyrics
 * come from" goes through here, so the player core never learns whether a track
 * is a file on disk or something a server handed us. Adding a source means
 * adding one object to `SOURCES` and giving its tracks a `source` id; no change
 * to the engine, the queue, or the views.
 *
 * Only `local` is implemented. A remote source (Subsonic, Jellyfin, an official
 * streaming SDK) would implement this same interface.
 */
export interface TrackSource {
  id: string
  name: string
  /** One line for the sources screen. */
  summary: string
  online: boolean
  /** Playable URL for this track, or null when the source cannot serve it. */
  streamUrl(track: Track): string | null
  /** Artwork URL, or null. Must stay same-origin or CORS-clean for Web Audio. */
  artUrl(track: Track): string | null
  /** Raw LRC text, or null. */
  lyrics(track: Track): Promise<string | null>
}

/**
 * Files the user added to the library.
 *
 * In Electron this returns URLs on the private `aurora-media:` scheme, served
 * by the main process with range support. In the browser harness there is no
 * filesystem, so artwork comes from the generated demo covers and audio is
 * handled by the synthetic driver instead.
 */
 const localSource: TrackSource = {
  id: 'local',
  name: '本地文件夹',
  summary: '扫描你添加的文件夹，直接播放磁盘上的文件，不联网',
  online: false,

  streamUrl: (track) => (isNative ? mediaUrl(track.path) : null),

  artUrl: (track) => {
    if (!track.hasArt) return null
    return isNative ? artUrl(track.path) : demoCoverFor(track)
  },

  lyrics: async (track) => {
    if (!isNative) return demoLyricsFor(track)

    // A sidecar file the user placed next to the audio always wins: it is their
    // own file, and it is the one that matches this exact recording.
    const local = (await window.aurora?.library.readLyrics(track.path)) ?? null
    if (local) return local

    // Online lookup is opt-in. The main process refuses when the setting is off,
    // so this call is safe to make unconditionally.
    const hit = await window.aurora?.lyrics.lookup({
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration
    })
    return hit?.text ?? null
  }
}

/**
 * Online source: Netease Cloud Music, reached through a third-party reverse
 * API running in the main process.
 *
 * Its tracks never enter the library. They carry no file, no scan and no tag
 * read, so they exist only as queue entries and as rows in the online view; the
 * seam below is the whole of its contact with player core.
 *
 * Two things about the shape here are deliberate:
 *
 * - `streamUrl` is synchronous, and the upstream URL only exists after a
 *   network round trip. So it returns null when the URL is not already cached
 *   and tells the store, which fetches it and then asks the engine to load the
 *   track again. Returning a URL built on the fly would require making this
 *   interface async, and every caller in the player core would have to change.
 * - The failure reason is never lost. "Could not get a URL" is not one
 *   condition: signed out, no membership, region-blocked and taken down are
 *   four different messages, and the store keeps the classified reason for the
 *   view to show.
 */
 const neteaseSource: TrackSource = {
  id: 'netease',
  name: '网易云音乐（在线）',
  summary: '第三方逆向接口，仅供个人学习自用；不是官方客户端，不提供绕过会员的能力',
  online: true,

  streamUrl: (track) => {
    const songId = neteaseSongId(track)
    if (songId === null) return null
    const stream = streamOf(songId)
    if (!stream) {
      // A miss, not a failure: the URL expired or was never fetched. Report it
      // and let the engine's next load pick the track up with a real URL.
      onMissingStream?.(songId)
      return null
    }
    return remoteStreamUrl(stream.url)
  },

  artUrl: (track) => {
    // The track carries the address when it came from this session's lists or
    // from history; the cache only covers rows built before that field existed.
    const cover = track.coverUrl ?? neteaseCoverCache.get(track.id)
    if (!cover) return null
    return remoteImageUrl(cover)
  },

  lyrics: async (track) => {
    const songId = neteaseSongId(track)
    if (songId === null || !hasNeteaseBackend) return null
    const raw = await netease.lyrics(songId)
    return mergeTranslation(raw?.lrc ?? null, raw?.translation ?? null)
  }
}

/**
 * Cover URLs, keyed by track id.
 *
 * `Track` carries `hasArt` but no address: `artUrl(track)` has to produce a
 * cover from the track alone. The upstream picture URL is therefore remembered
 * when the view builds its rows, which also keeps it out of every `Track` the
 * local library persists.
 */
const neteaseCoverCache = new Map<string, string>()

export function rememberNeteaseCover(trackId: string, picUrl: string | null): void {
  if (picUrl) neteaseCoverCache.set(trackId, picUrl)
}

/**
 * "The engine wanted a URL and the cache had none."
 *
 * `streamUrl` is synchronous, so it cannot fetch; it can only report the miss
 * and let the one module that may import both the source and the transport
 * (`player/netease.ts`) fetch it and ask the engine to load the track again.
 * Registering the handler there is what keeps this file free of the player and
 * the Netease store free of the engine.
 */
let onMissingStream: ((songId: number) => void) | null = null

export function setMissingStreamHandler(handler: ((songId: number) => void) | null): void {
  onMissingStream = handler
}

/**
 * QQ 音乐：与网易云同一套接缝，取流的地址来自在线层的缓存。
 *
 * 与网易云的区别只有一个——这里不记得「上一次取到的是哪个 url」，缓存由
 * `features/online/streams` 统一持有（它同时记失败原因与过期时间）。所以
 * `streamUrl` 只做一次查表，未命中就交给 `player/pick` 去补取。
 */
 const qqSource: TrackSource = {
  id: 'qq',
  name: 'QQ 音乐（在线）',
  summary: '第三方逆向接口，仅供个人学习自用；不是官方客户端，也不提供绕过会员的能力',
  online: true,

  streamUrl: (track) => {
    if (track.onlineId === undefined) return null
    const stream = cachedStream('qq', track.onlineId)
    return stream ? remoteStreamUrl(stream.url) : null
  },

  artUrl: (track) => (track.coverUrl ? remoteImageUrl(track.coverUrl) : null),

  lyrics: async () => null
}

export const SOURCES: TrackSource[] = [localSource, neteaseSource, qqSource]

/** Resolve the source responsible for a track. */
export function sourceFor(track: Track | null): TrackSource {
  if (!track) return localSource
  return SOURCES.find((source) => source.id === track.source) ?? localSource
}

/**
 * Artwork for a track, or null.
 *
 * Null is a meaningful answer rather than an error: callers render a neutral
 * placeholder instead of a broken image.
 */
export function artworkFor(track: Track | null): string | null {
  if (!track) return null
  return sourceFor(track).artUrl(track)
}
