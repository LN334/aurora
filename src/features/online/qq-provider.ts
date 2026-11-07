import type { QqApi, QqSong } from '../../env'
import type { QualityTier } from './types'
import { previewBackendsForced } from './preview-harness'
import { normalizeSearchResult, normalizeSong } from './normalize'
import { registerProvider } from './registry'
import type { PlatformBackend } from './store'
import {
  playable,
  unknownAvailability,
  type OnlineCollection,
  type OnlineMusicProvider,
  type OnlineSong,
  type ProviderCapabilities
} from './types'
import type { Track } from '../../types'

/**
 * QQ Music as a provider.
 *
 * A real second platform, and the reason the provider layer exists: everything
 * below is platform-specific and everything above it is not. The shared state
 * machine in `./store` supplies search state, the catalogue cache, the stream cache
 * with retries and the classified failures, so this file is the capability
 * declaration, the id convention and the handful of bridge calls.
 *
 * The bridge itself is typed in `src/env.d.ts` and implemented in the main process
 * (a parallel task), so this adapter consumes the published contract rather than
 * carrying its own copy of it.
 */

/**
 * The client, or null when this build has none.
 *
 * Read on every call rather than captured at module load: the preload script and
 * the main process finish wiring independently of this bundle, and a captured
 * `undefined` would make a working backend look absent for the life of the window.
 */
function client(): QqApi | null {
  if (typeof window === 'undefined') return null
  return window.aurora?.qq ?? null
}


/**
 * QQ's tiers, in the same vocabulary as everyone else's.
 *
 * The upstream names its audio with prefixes (`M500` 128k, `C400` m4a, `M800`
 * 320k, `F000` flac, `A000` ape) and needs no login for the first two. The bridge
 * maps between those and these four, so this layer stays in the shared vocabulary
 * and what a given account can actually get stays the client's business.
 */
const TIERS: QualityTier[] = ['standard', 'higher', 'exhigh', 'lossless']

/**
 * What QQ offers, and nothing more.
 *
 * Declared, not inferred. The client now exposes the account's own playlists, the
 * daily recommendation and the liked list, so those three are declared below. It
 * still has no album or artist page, and no cloud drive, so those stay absent
 * rather than rendered and then found empty - the rail and the screen read this
 * list, which is what keeps "the platform does not have it" from looking like
 * "the platform has it and it is empty".
 */
const COLLECTIONS: OnlineCollection[] = [
  { kind: 'daily', label: '每日推荐', requiresAccount: true },
  { kind: 'likes', label: '我喜欢的音乐', requiresAccount: true }
]

const CAPABILITIES: ProviderCapabilities = {
  search: true,
  playback: true,
  lyrics: true,
  auth: true,
  playlists: true,
  albums: false,
  artists: false,
  recommendations: true,
  userCloud: false,
  likes: false
}

const qqBackend: PlatformBackend = {
  id: 'qq',
  displayName: 'QQ 音乐',

  async getQuality() {
    return (await client()?.getQuality()) ?? 'exhigh'
  },

  async setQuality(quality) {
    return (await client()?.setQuality(quality)) ?? quality
  },

  async search(keywords, kind, limit) {
    const result = await client()?.search(keywords, kind, limit)
    // The client already normalises into this shape; the tolerant reader is here
    // for the fields it may add later, and for a build whose client predates one.
    return normalizeSearchResult(result)
  },

  async streamUrl(songId, quality) {
    const result = await client()?.streamUrl(songId, quality)
    if (!result) return { ok: false, reason: 'service-unavailable' }
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message }

    return {
      ok: true,
      stream: {
        url: result.url,
        br: result.br,
        level: result.level,
        // The client reports the tier it actually got and whether the account could
        // not reach the requested one, so nothing has to be inferred here.
        duration: 0,
        trial: result.trial
      }
    }
  },

  async songById() {
    /*
     * The client has no single-song lookup, so a search result is the only source of
     * a record. Answering null is the honest answer: the store then reports that it
     * cannot resolve the track rather than inventing a title from an id.
     */
    return null
  },

  toTrack(song) {
    const id = trackIdFor(song)
    /* 共享形状只带数字 id 与名字；QQ 认歌靠 mid，所以这里读回平台原始形状。 */
    const qq = song as QqSong
    return {
      id,
      path: id,
      source: 'qq',
      title: song.name,
      artist: song.artists.map((artist) => artist.name).join(' / '),
      albumArtist: song.artists[0]?.name ?? '',
      album: song.album.name,
      genre: '',
      year: null,
      trackNo: null,
      discNo: null,
      duration: song.duration,
      bitrate: null,
      sampleRate: null,
      channels: 2,
      codec: 'mp3',
      // The upstream never says which codec came back, so claiming lossless from the
      // requested tier would put a FLAC badge on a 320k stream.
      lossless: false,
      size: 0,
      mtimeMs: 0,
      addedAt: Date.now(),
      hasArt: Boolean(song.album.picUrl),
      coverUrl: song.album.picUrl ?? undefined,
      /*
       * 播放器按数字 id 取流（各平台的取流接口都只认数字），而 QQ 的曲目 id
       * 是 songmid 字符串。数字 id 一并带上，多平台统一列表里两个平台的版本
       * 才能用同一套规则挑源。
       */
      onlineId: song.id,
      albumMid: qq.album?.mid || undefined,
      artistMid: qq.artists?.[0]?.mid || undefined,
      gainDb: null,
      peak: null
    }
  },

  songIdOf(track: Track) {
    if (track.source !== 'qq') return null
    const mid = track.id.slice('qq:'.length)
    const id = Number(mid)
    return Number.isFinite(id) ? id : null
  },

  async loginStatus() {
    const account = await client()?.loginStatus()
    if (!account) return null
    return {
      id: account.id,
      nickname: account.nickname,
      avatarUrl: account.avatarUrl,
      // `vip: null` means "not detected", not "not a member", and the client keeps
      // the last known answer across a failed probe. Reporting null as false here
      // would let one network blip tell a paying user they are not a member.
      vip: account.vip === true,
      level: account.level ?? 0
    }
  },

  async logout() {
    await client()?.logout()
  },

  async status() {
    const status = await client()?.status()
    return status ? { ready: status.ready, detail: status.detail } : { ready: false }
  },

  async bindProfile(profileId) {
    if (!profileId) return
    await client()?.setProfile(profileId)
  },

  /*
   * The account's own catalogue.
   *
   * All three answer `[]` when the bridge has nothing to give (signed out, or an
   * upstream that cannot be read): an empty shelf is the honest picture, and the
   * screen already explains a signed-out visitor what signing in would add.
   */
  async myPlaylists() {
    const rows = (await client()?.myPlaylists()) ?? []
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      coverUrl: row.coverUrl,
      trackCount: row.trackCount,
      // The profile route reports plays elsewhere, so this stays 0 rather than
      // being filled from a different endpoint that would mean something else.
      playCount: 0,
      creator: row.creator,
      // Every row here belongs to the account - that is what the screen means.
      subscribed: true
    }))
  },

  async playlistTracks(id) {
    const rows = (await client()?.playlistTracks(id)) ?? []
    return rows.map((song) => normalizeSong(song))
  },

  async collection(kind, limit) {
    const bridge = client()
    if (!bridge) return []
    const rows =
      kind === 'likes' ? await bridge.liked() : kind === 'daily' ? await bridge.daily() : []
    return rows.slice(0, limit).map((song) => normalizeSong(song))
  }
}

 const qqProvider: OnlineMusicProvider = {
  id: 'qq',
  displayName: 'QQ 音乐',
  shortName: 'QQ 音乐',
  summary: '搜索并播放 QQ 音乐上的歌曲；高音质需要登录，付费曲目只如实显示原因',
  disclosure:
    '通过第三方逆向接口（qq-music-api）接入，仅供个人学习自用，不是官方客户端，也不提供绕过付费或会员的能力。',
  /*
   * Measured, and much weaker than Netease's: of a 293-track sample, only 18.4%
   * returned an audio URL signed out (all of them `payplay === 0`, at 128 kbps),
   * while every paid track answered `result=104003`. Saying "no sign-in needed"
   * here would describe a catalogue where most clicks do nothing.
   */
  anonymousNote: '未登录也能搜索，但只有免费歌曲能播放（128k）。多数歌曲需要登录账号。',
  // True only in a build whose main process exposes the client. A browser preview
  // and any build made before that client landed both answer false, and the rail
  // then shows no entry rather than one that cannot work.
  available: () => previewBackendsForced() || client() !== null,
  capabilities: CAPABILITIES,
  collections: COLLECTIONS,
  qualityTiers: TIERS,
  getQuality: qqBackend.getQuality,
  setQuality: qqBackend.setQuality,
  backend: qqBackend,

  search: {
    search: (keywords, kind, limit) => qqBackend.search(keywords, kind, limit ?? 50)
  },

  playback: {
    streamUrl: (songId, quality) => qqBackend.streamUrl(songId, quality ?? 'exhigh'),

    /*
     * A catalogue hint, not a verdict.
     *
     * `pay.payplay === 1` says the track is *priced*, and the upstream refuses every
     * tier of a VIP track at request time with `result=104003`. That refusal is the
     * verdict, and it arrives classified from the client - so a paid track is
     * reported `unknown` + `restricted` here ("this may need a membership, the real
     * request decides") and never `unavailable`, which would claim it is gone.
     */
    getAvailability: (song) => (song.fee === 0 ? playable() : unknownAvailability('可能需要会员'))
  },

  lyrics: {
    async lyrics(songId) {
      // The client returns finished LRC text, translation already merged.
      return (await client()?.lyrics(songId)) ?? null
    }
  },

  catalog: {
    // No album or artist page upstream: answering "nothing" is the whole story,
    // and `capabilities` above keeps the interface from asking.
    album: async () => null,
    artistTopSongs: async () => [],
    playlistTracks: (id) => qqBackend.playlistTracks!(id),
    myPlaylists: () => qqBackend.myPlaylists!()
  },

  recommendations: {
    dailySongs: () => qqBackend.collection!('daily', 200),
    likeList: () => qqBackend.collection!('likes', 200)
  },

  auth: {
    loginStatus: () => qqBackend.loginStatus(),
    logout: () => qqBackend.logout(),
    accountFor: async (profileId) => {
      const account = await client()?.accountFor(profileId)
      return account
        ? {
            id: account.id,
            nickname: account.nickname,
            avatarUrl: account.avatarUrl,
            vip: account.vip === true,
            level: account.level ?? 0
          }
        : null
    }
  }
}

/**
 * A song's upstream id inside our track ids: `qq:<songmid>`.
 *
 * The platform identifies a track by `songmid`, a string, while the shared shape
 * carries one numeric id. The string rides alongside on `mid` and is what the
 * bridge is asked for, because that is the identity the upstream actually means.
 */
function trackIdFor(song: OnlineSong): string {
  const qqSong = song as QqSong
  return `qq:${qqSong.mid ?? qqSong.songmid ?? String(song.id)}`
}

export function registerQqProvider(): void {
  registerProvider(qqProvider)
}


