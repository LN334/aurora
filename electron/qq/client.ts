import {
  likedPlaylistId,
  mergeTranslation,
  normalizeAlbumInfo,
  normalizeAlbumSongs,
  normalizeCollectedAlbums,
  normalizeLyrics,
  normalizeNewSongs,
  normalizePlaylistTracks,
  normalizePlaylists,
  normalizeQr,
  normalizeSearch,
  normalizeSongCollection,
  normalizeTopDetail,
  readAccountProbe,
  readQrCheck,
  readVipProbe
} from './normalize'
import { write as log } from '../startup-log'
import { classifyStreamFailure, describeFailure } from './reasons'
import type { QqFailureReason } from './reasons'
import { clearSession, hasSession, readState, writeState } from './session'
import {
  TIER_FORMATS,
  cookieValue,
  loadSdk,
  playInfoOf,
  requestAccount,
  requestAlbumInfo,
  requestAlbumSongs,
  requestCollectedAlbums,
  requestDailyPlaylistId,
  requestDailyRecommend,
  requestLikedSongs,
  requestLoginQr,
  requestLoginQrCheck,
  requestLyric,
  requestMyPlaylists,
  requestNewSongs,
  requestPlay,
  requestPlaylistTracks,
  requestMacHomePlaylists,
  requestSearch,
  requestOwnedPlaylists,
  requestPlaylistCreate,
  requestPlaylistDelete,
  requestPlaylistRename,
  requestPlaylistTracksEdit,
  requestSongLike,
  requestTopDetail,
  requestVipInfo,
  tierLadder,
  uinDigits
} from './transport'
import type { QqOwnedPlaylist } from './transport'
import type {
  QqAccount,
  QqAlbumBundle,
  QqCollectedAlbum,
  QqPlaylistSummary,
  QqQuality,
  QqQrResult,
  QqQrSession,
  QqSearchResult,
  QqSong,
  QqStatusResult,
  QqStreamResult
} from './types'

/**
 * The QQ Music client.
 *
 * Three things shape this file.
 *
 * 1. **The upstream package is loaded lazily.** It is a koa application with its
 *    whole route table and axios behind it, so `require`-ing it at import time
 *    would put that cost in front of Aurora's first window. It is loaded on the
 *    first real call (see `transport.loadSdk`) and never at module load.
 *
 * 2. **Nothing throws at the renderer.** Every exported method answers with the
 *    contract's shape; a transport failure becomes a classified reason. A
 *    rejected `invoke` surfaces in page code as an unhandled rejection in the
 *    middle of a render, which for a player means a blank view.
 *
 * 3. **A refusal is a first-class answer.** Mainstream QQ tracks are paywalled,
 *    so "no address, and here is why" is the *normal* path, not an error path.
 *    It is produced by the tier ladder plus `reasons.ts`, and it is the only
 *    place a membership limit is ever claimed.
 */

/**
 * Which profile's account the next call belongs to.
 *
 * Set by `qq:setProfile` before the renderer asks for anything, because the
 * session cookie, the account and the quality preference are all per profile.
 * Without it every profile would share one account - the same bug
 * `electron/netease/client.ts` documents at length.
 */
let activeProfileId = 'default'

/**
 * Ids seen in this session, so a numeric id can be played.
 *
 * QQ's play route is built from `songmid`: handing it the numeric `songid`
 * answers `result: 101404` with no address (verified live), so a numeric id
 * cannot be played on its own. The renderer's shared song shape is numeric
 * (`src/features/online/normalize.ts`), so every search records the mapping and
 * this is what recovers the mid.
 *
 * The cache is bounded and in-memory: a catalogue that outlives the process can
 * still be played when the renderer passes the mid, which is what `QqSong.mid`
 * is for.
 */
const songIndex = new Map<number, { songmid: string; mediaMid: string; paid: boolean }>()
const SONG_INDEX_LIMIT = 4000

/** How long a membership answer is trusted before it is asked again. */
const VIP_TTL_MS = 10 * 60 * 1000

export function setActiveProfile(profileId: string): boolean {
  const next = String(profileId ?? '').trim() || 'default'
  if (next !== activeProfileId) {
    // Nothing is cached across a switch: the quality, the cookie and the
    // account all belong to the profile that was active when they were read.
    activeProfileId = next
  }
  return true
}

export function activeProfile(): string {
  return activeProfileId
}

export function profileHasSession(profileId: string): boolean {
  return hasSession(profileId)
}

// --- status -------------------------------------------------------------

/** Whether the upstream dependency can be loaded at all. */
let loadDetail = ''

function ensureLoaded(): boolean {
  try {
    loadSdk()
    loadDetail = ''
    return true
  } catch (error) {
    loadDetail = error instanceof Error ? error.message : String(error)
    return false
  }
}

export async function qqStatus(): Promise<QqStatusResult> {
  const ready = ensureLoaded()
  const loggedIn = ready && hasSession(activeProfileId)
  const detail = ready ? '' : `QQ 音乐接口不可用：${loadDetail}`
  return detail ? { ready, loggedIn, detail } : { ready, loggedIn }
}

// --- search -------------------------------------------------------------

export async function qqSearch(
  keywords: string,
  type: 'song' | 'album' | 'artist',
  limit = 50
): Promise<QqSearchResult> {
  ensureLoaded()
  const response = await requestSearch({ keywords, limit })
  const result = normalizeSearch(response, limit)

  for (const song of result.songs) {
    remember(song.id, song.songmid, song.mediaMid, song.paid)
  }
  // `type` cannot change the upstream query: the service ignores `remoteplace`
  // and always answers one song list plus one "did you mean" block. The
  // parameter is accepted because the contract has it; the sections are the
  // same for every value. See `normalize.normalizeSearch`.
  void type
  return result
}

function remember(songId: number, songmid: string, mediaMid: string, paid: boolean): void {
  if (!songId || !songmid) return
  if (songIndex.size >= SONG_INDEX_LIMIT) {
    const oldest = songIndex.keys().next()
    if (!oldest.done) songIndex.delete(oldest.value)
  }
  songIndex.set(songId, { songmid, mediaMid, paid })
}

/**
 * Recover the `songmid` for whatever the renderer passes.
 *
 * A mid is used as-is; a numeric id is looked up in what this session has seen.
 * Returning '' means "cannot play this", which is answered with an honest
 * message rather than a request that upstream will refuse for the wrong reason.
 */
function resolveSongmid(songId: string | number): string {
  if (typeof songId === 'string' && songId && !/^\d+$/.test(songId)) return songId
  const numeric = typeof songId === 'number' ? songId : Number(songId)
  if (!Number.isFinite(numeric)) return ''
  return songIndex.get(numeric)?.songmid ?? ''
}

// --- playback -----------------------------------------------------------

/**
 * Resolve a playable address.
 *
 * The ladder is the whole point: upstream refuses a tier it will not serve with
 * an empty `purl` and no error, so a request for the default `exhigh` on a
 * signed-out machine is refused even for a free track (verified live: 320k and
 * FLAC answer `result: 104003` while 128k succeeds). Walking down to the free
 * tier is what makes QQ playable at all; the refusal is only reported once the
 * last tier is refused too, which is also when it becomes true that the *track*
 * is restricted rather than the tier.
 */
export async function qqStreamUrl(
  songId: string | number,
  quality?: QqQuality
): Promise<QqStreamResult> {
  const state = readState(activeProfileId)
  const requested = quality ?? state.quality
  const songmid = resolveSongmid(songId)
  if (!songmid) {
    return {
      ok: false,
      reason: 'unknown',
      message: '无法确定这首歌的 QQ 音乐编号，请重新搜索后再播放'
    }
  }

  const known = songIndex.get(typeof songId === 'number' ? songId : Number(songId))
  const mediaMid = known?.mediaMid ?? ''
  const paidHint = known?.paid ?? false
  const loggedIn = state.cookie.length > 0

  let lastReason: QqFailureReason | null = null
  let lastMessage = ''

  for (const tier of tierLadder(requested)) {
    const format = TIER_FORMATS[tier]
    let info
    try {
      info = playInfoOf(
        await requestPlay({ songmid, quality: format.format, mediaMid, cookie: state.cookie })
      )
    } catch (error) {
      // A transport failure is not a tier problem, so walking further down
      // would just repeat the same failure three times.
      const reason = classifyStreamFailure({ error })
      return { ok: false, reason, message: describeFailure(reason) }
    }

    if (info.url) {
      return {
        ok: true,
        url: info.url,
        quality: requested,
        // The tier actually delivered, not the one asked for.
        level: tier,
        br: format.bitrate,
        lossless: format.lossless,
        trial: false
      }
    }

    const reason = classifyStreamFailure({
      code: info.envelopeCode ?? info.requestCode,
      result: info.result,
      purl: info.purl,
      paidHint,
      loggedIn
    })
    lastReason = reason
    lastMessage = describeFailure(reason)
  }

  return {
    ok: false,
    reason: lastReason ?? 'unknown',
    message: lastMessage || describeFailure('unknown')
  }
}

// --- lyrics -------------------------------------------------------------

/**
 * Lyrics, with the translation already merged.
 *
 * The bridge hands the renderer one string (`src/features/online/qq-provider.ts`
 * says so explicitly: "The client returns finished LRC text, translation already
 * merged"), because the lyric view highlights one line per timestamp and two
 * documents would never line up.
 */
export async function qqLyrics(songId: string | number): Promise<string | null> {
  const state = readState(activeProfileId)
  const songmid = resolveSongmid(songId)
  const numeric = typeof songId === 'number' ? songId : Number(songId)

  try {
    const response = await requestLyric({
      // The lyric route accepts either identifier, unlike the play route.
      songmid,
      songid: songmid ? '' : Number.isFinite(numeric) ? String(numeric) : '',
      cookie: state.cookie
    })
    const payload = normalizeLyrics(response)
    if (!payload) return null
    return mergeTranslation(payload.lrc, payload.translation)
  } catch (error) {
    console.error('[aurora] qq lyric lookup failed', error instanceof Error ? error.message : error)
    return null
  }
}

// --- login --------------------------------------------------------------

/**
 * The pending QR code, keyed by an opaque token.
 *
 * The renderer only ever sees `key`, so the `ptqrtoken`/`qrsig` pair the poll
 * needs never has to survive a round trip through the page. One login at a time
 * is all the interface can start, so this is a single slot rather than a map.
 */
let pendingQr: { key: string; ptqrtoken: string; qrsig: string; at: number } | null = null
const QR_TTL_MS = 5 * 60 * 1000

export async function qqQrCreate(): Promise<QqQrSession> {
  ensureLoaded()
  const response = await requestLoginQr()
  const qr = normalizeQr(response)
  if (!qr) return { key: '', imageDataUrl: '' }

  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  pendingQr = { key, ptqrtoken: qr.ptqrtoken, qrsig: qr.qrsig, at: Date.now() }
  return { key, imageDataUrl: qr.imageDataUrl }
}

export async function qqQrCheck(key: string): Promise<QqQrResult> {
  const pending = pendingQr
  if (!pending || pending.key !== key) {
    // A key this process never issued, or one from a previous run.
    return { status: 'expired', message: '二维码已失效，请重新获取' }
  }
  if (Date.now() - pending.at > QR_TTL_MS) {
    pendingQr = null
    return { status: 'expired', message: '二维码已过期，请重新获取' }
  }

  const checked = readQrCheck(await requestLoginQrCheck(pending))
  if (checked.confirmed) {
    pendingQr = null
    const cookie = checked.session?.cookie ?? ''
    const uin = checked.session?.uin ?? cookieValue(cookie, 'uin', 'qqmusic_uin')
    writeState(activeProfileId, {
      cookie,
      uin: uinDigits(uin),
      euin: checked.session?.euin ?? '',
      // A fresh login invalidates any membership answer from the previous one.
      vip: null,
      vipCheckedAt: 0
    })
    const account = await qqLoginStatus()
    return { status: 'confirmed', account: account ?? undefined }
  }
  if (checked.expired) {
    pendingQr = null
    return { status: 'expired', message: checked.message || '二维码已过期，请重新获取' }
  }
  /*
   * Upstream only reports "logged in", "expired" and "not scanned yet" - there
   * is no separate "scanned, waiting for the phone" state - so `scanned` is
   * never produced for QQ. The message upstream sent is passed through so the
   * interface can still say something specific.
   */
  return { status: 'waiting', message: checked.message }
}

/**
 * Who this profile is signed in as.
 *
 * Three outcomes, and keeping them apart is the point:
 *  - upstream answers a profile        -> that account, merged into the session
 *  - upstream answers "not signed in"  -> null, but the cookie is *kept*. Only
 *    `logout()` forgets a credential; a rejected probe is not proof the user
 *    wants to be signed out, and deleting on a bad probe would log people out
 *    over a network blip.
 *  - the probe fails for any other reason -> whatever was already known, so a
 *    blip cannot make the account disappear.
 */
export async function qqLoginStatus(): Promise<QqAccount | null> {
  return await accountOf(activeProfileId)
}

async function accountOf(profileId: string): Promise<QqAccount | null> {
  const state = readState(profileId)
  if (!state.cookie) return null

  const stored = accountFrom(state)
  const uin = state.uin || uinDigits(cookieValue(state.cookie, 'uin', 'qqmusic_uin'))
  if (!uin) return stored

  try {
    const probe = readAccountProbe(await requestAccount({ uin, cookie: state.cookie }))
    if (!probe.authenticated) return null

    const patch: Parameters<typeof writeState>[1] = {
      nickname: probe.nickname || state.nickname,
      avatarUrl: probe.avatarUrl ?? state.avatarUrl,
      uin
    }
    if (probe.level !== null) patch.level = probe.level

    // The membership answer is asked separately and merged only when it really
    // answered: a failed probe must never overwrite the last known value.
    const vip = await membershipOf(state.cookie, state.vip, state.vipCheckedAt)
    if (vip.vip !== null) {
      patch.vip = vip.vip
      patch.vipCheckedAt = vip.checkedAt
    }

    const next = writeState(profileId, patch)
    return accountFrom(next)
  } catch (error) {
    console.error(
      '[aurora] qq account probe failed, keeping the stored account',
      error instanceof Error ? error.message : error
    )
    return stored
  }
}

/**
 * The membership flag, with a grace window.
 *
 * Mineradio's lesson, applied: a membership check that fails must not be cached,
 * because caching "not a member" turns one bad request into a paying user being
 * told their membership lapsed. So the answer is only *written* when upstream
 * actually answered, and a successful answer is believed for ten minutes before
 * it is asked again.
 */
async function membershipOf(
  cookie: string,
  previous: boolean | null,
  checkedAt: number
): Promise<{ vip: boolean | null; checkedAt: number }> {
  if (previous !== null && Date.now() - checkedAt < VIP_TTL_MS) {
    return { vip: previous, checkedAt }
  }
  try {
    const probe = readVipProbe(await requestVipInfo({ cookie }))
    // `answered` is what keeps a blip from becoming an answer: the endpoint is
    // a public configuration blob that answers `code: 0` even to a bogus
    // cookie, so only its own request code decides whether it spoke.
    if (!probe.answered || probe.vip === null) return { vip: previous, checkedAt }
    return { vip: probe.vip, checkedAt: Date.now() }
  } catch {
    return { vip: previous, checkedAt }
  }
}

/** The account a *specific* profile is signed in as, for the profiles screen. */
export async function qqAccountFor(profileId: string): Promise<QqAccount | null> {
  const previous = activeProfileId
  try {
    setActiveProfile(profileId)
    return await accountOf(activeProfileId)
  } finally {
    activeProfileId = previous
  }
}

export async function qqLogout(): Promise<boolean> {
  clearSession(activeProfileId)
  // A pending QR belongs to the account that was just signed out.
  pendingQr = null
  return true
}

/** Sign a specific profile out without disturbing the active one. */
export function qqLogoutProfile(profileId: string): boolean {
  clearSession(profileId)
  if (profileId === activeProfileId) pendingQr = null
  return true
}

// --- quality ------------------------------------------------------------

export function qqGetQuality(): QqQuality {
  return readState(activeProfileId).quality
}

export function qqSetQuality(quality: QqQuality): QqQuality {
  return writeState(activeProfileId, { quality }).quality
}

// --- helpers ------------------------------------------------------------

function accountFrom(state: {
  uin: string
  nickname: string
  avatarUrl: string | null
  vip: boolean | null
  level: number
}): QqAccount {
  return {
    id: Number(uinDigits(state.uin)) || 0,
    nickname: state.nickname || 'QQ 音乐用户',
    avatarUrl: state.avatarUrl,
    vip: state.vip,
    level: state.level
  }
}
// --- library ------------------------------------------------------------

/**
 * The profile's own playlists.
 *
 * Signed out there is nothing to list, so the cookie check comes first and costs
 * no request. A failure answers `[]` rather than throwing, for the same reason
 * every other method here does: a library that cannot be read must look empty,
 * not like a dead screen.
 */
export async function qqMyPlaylists(limit = 60): Promise<QqPlaylistSummary[]> {
  const state = readState(activeProfileId)
  if (!state.cookie) return []
  const uin = state.uin || uinDigits(cookieValue(state.cookie, 'uin', 'qqmusic_uin'))
  if (!uin) return []

  try {
    const response = await requestMyPlaylists({ uin, cookie: state.cookie, limit })
    return normalizePlaylists(response)
  } catch (error) {
    console.error('[aurora] qq playlist list failed', messageOf(error))
    return []
  }
}

/**
 * 平台推荐位上的 QQ 歌单。
 *
 * 只从 Mac 版首页「为你推荐」那一栏取：登录账号的第一张是「今日私享」，后面
 * 是「每个周五听点新的」这类个人向歌单。取不到就空着——公开榜不是「按你的
 * 口味推」，榜单以后单独开一页，不塞进这里。
 */
export async function qqRecommendPlaylists(limit = 12): Promise<QqPlaylistSummary[]> {
  if (!hasSession(activeProfileId)) return []
  const state = readState(activeProfileId)
  if (!state.cookie) return []
  try {
    const rows = await requestMacHomePlaylists({ cookie: state.cookie })
    // 「今日私享」是日推，不该出现在推荐歌单里；其余按页面顺序取。
    const picks = rows.filter((row) => !row.name.includes('今日私享')).slice(0, limit)
    log('qq recmd pl mac rows=' + picks.length)
    return picks.map((row) => ({
      id: Number(row.rid),
      name: row.name,
      coverUrl: row.cover,
      trackCount: 0,
      creator: ''
    }))
  } catch (error) {
    log('qq recmd pl mac failed ' + messageOf(error))
    return []
  }
}

/** One playlist's songs. Rows are remembered like search results, so they play. */
export async function qqPlaylistTracks(disstid: string | number): Promise<QqSong[]> {
  const id = String(disstid ?? '').trim()
  if (!id) return []
  const state = readState(activeProfileId)

  /*
   * 榜与歌单共用这一个入口，靠编号区分：榜的 topId 是三四位数（4、26、62），
   * 歌单的 disstid 是十位数（9793639801）。所以小的走榜详情，大的走歌单详情。
   */
  const numeric = Number(id)
  if (Number.isFinite(numeric) && numeric > 0 && numeric < 100000) {
    try {
      const response = await requestTopDetail({ topId: numeric, limit: 100 })
      return rememberAll(normalizeTopDetail(response))
    } catch (error) {
      console.error('[aurora] qq top list detail failed', messageOf(error))
      return []
    }
  }

  try {
    const response = await requestPlaylistTracks({ disstid: id, cookie: state.cookie })
    rememberCreator(String(id), response)
    return rememberAll(normalizePlaylistTracks(response))
  } catch (error) {
    console.error('[aurora] qq playlist detail failed', messageOf(error))
    return []
  }
}

/** 歌单创建者。详情响应里 `cdlist[0].nick`/`nickname` 实测有值（官方歌单也一样）。 */
const playlistCreators = new Map<string, string>()

function rememberCreator(disstid: string, response: unknown): string {
  const wrap = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const body = wrap(wrap(response).body)
  const cdlist = wrap(body.response).cdlist
  const owner = wrap(Array.isArray(cdlist) ? cdlist[0] : undefined)
  const name = [owner.nickname, owner.nick, wrap(owner.creator).name].find(
    (value): value is string => typeof value === 'string' && value !== ''
  )
  if (name) playlistCreators.set(disstid, name)
  return name ?? ''
}

/** 推荐歌单的列表项不带作者，打开详情时补问一次。 */
export async function qqPlaylistCreator(id: number): Promise<string> {
  const key = String(id)
  const cached = playlistCreators.get(key)
  if (cached) return cached
  const state = readState(activeProfileId)
  if (!state.cookie) return ''
  try {
    const response = await requestPlaylistTracks({ disstid: key, cookie: state.cookie })
    return rememberCreator(key, response)
  } catch (error) {
    log(`[aurora] qq playlist creator failed ${messageOf(error)}`)
    return ''
  }
}

/**
 * Album numeric id -> mid, learned from every list that carried both.
 *
 * The detail and tracklist routes accept the mid only, while the rest of the app
 * addresses albums by number. Anything opened from a shelf or a search result has
 * been through here, so the lookup works; an id seen nowhere answers null rather
 * than inventing a mid.
 */
const albumMids = new Map<number, string>()

/** Remember the pair so a later detail call can resolve it. */
function rememberAlbum(id: number, mid: string): void {
  if (id && mid) albumMids.set(id, mid)
}

/**
 * Albums this profile collected on the platform.
 *
 * Signed out answers an empty shelf, never an error: the collections page shows
 * what exists rather than a failure notice, and the platform card already says
 * "not signed in".
 */
export async function qqCollectedAlbums(limit = 200): Promise<QqCollectedAlbum[]> {
  const state = readState(activeProfileId)
  if (!state.cookie) return []
  const uin = state.uin || uinDigits(cookieValue(state.cookie, 'uin', 'qqmusic_uin'))
  if (!uin) return []

  try {
    const response = await requestCollectedAlbums({ uin, cookie: state.cookie, limit })
    const albums = normalizeCollectedAlbums(response)
    for (const album of albums) rememberAlbum(album.id, album.mid)
    return albums
  } catch (error) {
    console.error('[aurora] qq album shelf failed', messageOf(error))
    return []
  }
}

/**
 * One album with its tracklist, or null when it cannot be resolved.
 *
 * Two requests on purpose: the head carries the name, cover, year and brief, and
 * the tracklist is a separate paged route. Rows are remembered so the page can
 * play them without a second round-trip per song.
 */
export async function qqAlbum(
  id: number
): Promise<QqAlbumBundle | null> {
  const mid = albumMids.get(id)
  if (!mid) return null

  try {
    const [head, rows] = await Promise.all([
      requestAlbumInfo({ albummid: mid }),
      requestAlbumSongs({ albummid: mid })
    ])
    const detail = normalizeAlbumInfo(head, mid)
    if (!detail) return null
    rememberAlbum(detail.id, mid)
    return { detail, songs: rememberAll(normalizeAlbumSongs(rows)) }
  } catch (error) {
    log('qq album failed ' + messageOf(error))
    return null
  }
}

/**
 * The new-song shelf, signed in or not.
 *
 * The route is public, so this is the one "recommendation" that works for a
 * signed-out library - which makes it worth showing on the home page even when
 * the account card says "not signed in".
 */
export async function qqNewSongs(limit = 20): Promise<QqSong[]> {
  try {
    const response = await requestNewSongs({ limit })
    return rememberAll(normalizeNewSongs(response, limit))
  } catch (error) {
    log('qq new songs failed ' + messageOf(error))
    return []
  }
}

/**
 * The account's daily recommendation.
 *
 * 换了一条路：`get_recommend` 现在对所有人回 500003（见 transport 里
 * requestDailyPlaylistId 的注释），改成从 Mac 首页找「今日私享」歌单，再按普通
 * 歌单取曲目。老接口仍留在后面当退路——哪天它恢复了就能自己回来，两头都空时再
 * 由上层退到公开新歌。
 */
export async function qqDaily(): Promise<QqSong[]> {
  const state = readState(activeProfileId)
  if (!state.cookie) return []
  const uin = state.uin || uinDigits(cookieValue(state.cookie, 'uin', 'qqmusic_uin'))
  if (!uin) return []
  try {
    const disstid = await requestDailyPlaylistId({ cookie: state.cookie }).catch(() => null)
    if (disstid) {
      const detail = await requestPlaylistTracks({ disstid, cookie: state.cookie })
      const rows = normalizePlaylistTracks(detail)
      if (rows.length > 0) {
        log('qq daily via today-pl ' + disstid + ' rows=' + rows.length)
        return rememberAll(rows)
      }
      log('qq daily playlist empty ' + disstid)
    }
    const response = await requestDailyRecommend({ uin, cookie: state.cookie })
    const rows = normalizeSongCollection(response)
    if (rows.length === 0) log('qq daily empty ' + JSON.stringify(response).slice(0, 1000))
    return rememberAll(rows)
  } catch (error) {
    log('qq daily failed ' + messageOf(error))
    return []
  }
}

/** "我喜欢的音乐" on this account. */
export async function qqLiked(): Promise<QqSong[]> {
  const state = readState(activeProfileId)
  if (!state.cookie) return []
  const uin = state.uin || uinDigits(cookieValue(state.cookie, 'uin', 'qqmusic_uin'))
  if (!uin) return []

  try {
    /*
     * 两步：这个接口只给「我喜欢」歌单的摘要（disstid + 67 首），曲目要再问一次
     * songListDetail。直接拿摘要当歌单解析，结果永远是 0 首。
     */
    const head = await requestLikedSongs({ uin, cookie: state.cookie })
    const disstid = likedPlaylistId(head)
    if (!disstid) return []
    const tracks = await requestPlaylistTracks({ disstid, cookie: state.cookie })
    return rememberAll(normalizePlaylistTracks(tracks))
  } catch (error) {
    console.error('[aurora] qq liked list failed', messageOf(error))
    return []
  }
}




/**
 * QQ 的 g_tk：把 skey 逐字符累进 32 位哈希，取低 31 位。
 *
 * 网页版每个写请求都带这个数，算法是公开的（同为 hash33 的变体）；写错了上游
 * 只会答一个 500026，所以放在一处，别各写一遍。返回十进制字符串——comm 里按数字用。
 */
function hash33(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash += (hash << 5) + value.charCodeAt(index)
  }
  return String(hash & 0x7fffffff)
}



/**
 * 写操作要的三样：cookie、uin、authst。authst 就是 cookie 里的 qqmusic_key
 * （网易那套叫 p_skey 的地方），安卓 comm 用它认人；没有它写不进去，所以缺一样
 * 就当没登录处理。
 */
function credential(): { uin: string; cookie: string; authst: string } | null {
  const state = readState(activeProfileId)
  if (!state.cookie) return null
  const uin = state.uin || uinDigits(cookieValue(state.cookie, 'uin', 'qqmusic_uin'))
  if (!uin) return null
  const authst =
    cookieValue(state.cookie, 'p_skey') ||
    cookieValue(state.cookie, 'qqmusic_key', 'qm_keyst') ||
    cookieValue(state.cookie, 'skey') ||
    ''
  if (!authst) return null
  return { uin, cookie: state.cookie, authst }
}

/**
 * 在 Aurora 里点红心，等于在 QQ 音乐里点红心。
 *
 * 写接口要 id 与 mid 一对，而渲染层只带数字 id，mid 从这次会话见过的歌里找
 * （`songIndex`，和播放走的是同一份缓存）。找不到就不写：拿错 mid 去写比不写更糟。
 *
 * 返回 false 表示「没写成」——没登录、mid 不明、上游拒了、写完读不回来，都算。
 * 界面据此提示，不会把没发生的事说成发生了。
 */
export async function qqLike(songId: number, liked: boolean): Promise<boolean> {
  const auth = credential()
  if (!auth) return false
  const uin = auth.uin

  const cached = songIndex.get(songId)
  const mid = cached?.songmid ?? ''
  if (!mid) {
    log('qq like missing mid ' + songId)
    return false
  }

  /*
   * 写接口要 g_tk：由 cookie 里的 p_skey（或 qqmusic_key / qm_keyst）经 hash33 算出。
   * 没有它，同样的请求会从 80105 变成 500026——两种都是「没写成」，所以这里先算好。
   */
  const gtk = hash33(auth.authst)

  try {
    const result = await requestSongLike({
      uin,
      cookie: auth.cookie,
      authst: auth.authst,
      gtk,
      id: songId,
      mid,
      liked
    })
    if (!result.ok) log('qq like failed ' + songId + ' ' + (result.detail ?? ''))
    return result.ok
  } catch (error) {
    // 网络失败时真正的原因在 `cause` 里（ECONNRESET / DNS / 超时），只记 message 全是
    // 「fetch failed」，等于什么都没记。
    log('qq like failed ' + messageOf(error) + ' ' + messageOf((error as { cause?: unknown }).cause))
    return false
  }
}

/**
 * Record every row so a list fetched in one call can be played from another.
 *
 * Albums are remembered here too, not just in the shelf: a tracklist row carries
 * both the numeric album id and its mid, and the album page is only addressable
 * by mid. Learning the pair only when the shelf or the album page itself ran
 * meant that opening an album from a song - the common way in - always missed.
 */
function rememberAll(songs: QqSong[]): QqSong[] {
  for (const song of songs) {
    remember(song.id, song.songmid, song.mediaMid, song.paid)
    if (song.album?.id && song.album?.mid) rememberAlbum(song.album.id, song.album.mid)
  }
  return songs
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
// --- 歌单写 --------------------------------------------------------------
//
// 界面上歌单的 id 是 `tid`（dissid）；写要 `dirId`，由 transport 每次现读一次换出来。
// 这里只做「取凭证 → 转发 → 记日志」，判断权限与读回核对都在 transport 里。

export async function qqOwnedPlaylists(): Promise<QqOwnedPlaylist[]> {
  const auth = credential()
  if (!auth) return []
  try {
    return await requestOwnedPlaylists(auth)
  } catch (error) {
    log('qq playlists failed ' + messageOf(error) + ' ' + messageOf((error as { cause?: unknown }).cause))
    return []
  }
}

export async function qqPlaylistCreate(name: string): Promise<{ id: number; name: string } | null> {
  const auth = credential()
  if (!auth) return null
  try {
    const made = await requestPlaylistCreate(auth, name)
    if (!made) return null
    return { id: made.tid, name }
  } catch (error) {
    log('qq playlist create failed ' + messageOf(error))
    return null
  }
}

export async function qqPlaylistDelete(tid: number): Promise<boolean> {
  const auth = credential()
  if (!auth) return false
  try {
    return await requestPlaylistDelete(auth, tid)
  } catch (error) {
    log('qq playlist delete failed ' + messageOf(error))
    return false
  }
}

export async function qqPlaylistTracksEdit(tid: number, songIds: number[], add: boolean): Promise<boolean> {
  const auth = credential()
  if (!auth) return false
  try {
    return await requestPlaylistTracksEdit(auth, tid, songIds, add)
  } catch (error) {
    log('qq playlist tracks failed ' + messageOf(error))
    return false
  }
}

export async function qqPlaylistRename(tid: number, name: string): Promise<boolean> {
  const auth = credential()
  if (!auth) return false
  try {
    return await requestPlaylistRename(auth, tid, name)
  } catch (error) {
    log('qq playlist rename failed ' + messageOf(error))
    return false
  }
}
