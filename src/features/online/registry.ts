import type { Track } from '../../types'
import type {
  OnlineMusicProvider,
  PlaybackSourceRef,
  ProviderCapabilities,
  ProviderId
} from './types'

/**
 * The provider registry: one `Map<ProviderId, OnlineMusicProvider>` and nothing
 * else. Copied from the reference player's `providerRegistry.ts`, minus its
 * runtime register/unregister plumbing (Aurora has no plugin system, so the set
 * is fixed at module load and there is nothing to notify).
 *
 * Everything the interface knows about platforms comes from here. The rail, the
 * search screen's tabs and the settings page each call `useProviders()`; none of
 * them imports a platform module, and none of them names a platform.
 */

const providers = new Map<ProviderId, OnlineMusicProvider>()

/**
 * Registration order is display order.
 *
 * Netease first because it has been here longest, and because the order is used
 * verbatim by the rail and the search tabs - a stable order matters more than an
 * alphabetical one when the list is navigation.
 */
export function registerProvider(provider: OnlineMusicProvider): void {
  providers.set(provider.id, provider)
}

export function getProvider(id: ProviderId): OnlineMusicProvider | null {
  return providers.get(id) ?? null
}

/**
 * Every registered provider, in registration order.
 *
 * Not filtered by `available()`: a caller that wants "what can I offer the user"
 * asks for `listAvailableProviders()`, and a caller that wants "what exists"
 * (the settings page lists tiers for platforms the app supports) gets the full
 * set. Collapsing the two is how a disabled platform becomes invisible in a
 * screen that should still explain it.
 */
export function listProviders(): OnlineMusicProvider[] {
  return [...providers.values()]
}

/** The platforms usable right now, in registration order. */
export function listAvailableProviders(): OnlineMusicProvider[] {
  return listProviders().filter((provider) => provider.available())
}

export function providerSupports(
  provider: OnlineMusicProvider | null | undefined,
  capability: keyof ProviderCapabilities
): boolean {
  return Boolean(provider?.capabilities[capability])
}

/**
 * Which platform a track belongs to, or that it is a local file.
 *
 * This is the replacement for the scattered `track.source === 'netease'` checks.
 * It reads `Track.source`, which already exists and is already carried through
 * the player, the queue and the playlists - so a mixed queue and a mixed playlist
 * both answer correctly with no change to `Track` itself.
 *
 * `mediaId` is the platform's own id, taken from the part of the track id after
 * the colon. Ids are minted as `<providerId>:<upstreamId>` for exactly this
 * reason.
 */
export function getPlaybackSourceRef(track: Track | null | undefined): PlaybackSourceRef {
  const source = track?.source
  if (!track || !source || source === 'local') {
    return { kind: 'local', mediaId: track?.path ?? '' }
  }
  return {
    kind: 'online',
    providerId: source,
    mediaId: mediaIdOf(track.id, source)
  }
}

/** The upstream id inside a `<providerId>:<id>` track id. */
 function mediaIdOf(trackId: string, providerId: ProviderId): string {
  const prefix = `${providerId}:`
  return trackId.startsWith(prefix) ? trackId.slice(prefix.length) : trackId
}

/** The provider a track came from, or null for a local file. */
 function providerForTrack(track: Track | null | undefined): OnlineMusicProvider | null {
  const ref = getPlaybackSourceRef(track)
  return ref.kind === 'online' ? getProvider(ref.providerId) : null
}



/**
 * The display name of wherever a track came from, for a row's source label.
 *
 * Returns null for a local file so the caller decides whether "本机" is worth
 * printing; the row shows nothing rather than a label that says nothing.
 */
function sourceLabelFor(track: Track | null | undefined): string | null {
  return providerForTrack(track)?.shortName ?? providerForTrack(track)?.displayName ?? null
}

/**
 * A track's origin, as a row should print it.
 *
 * The plain label answers "which platform", which is only half the question a
 * mixed list raises: a local file returns null there, so a list of files and
 * Netease songs said nothing at all about the files. The tag answers the whole
 * question - a platform's short name, or 本机 - and carries the origin as a
 * second field so the row can tint it without testing for platforms.
 *
 * `listIsMixed` is what keeps the label honest instead of noisy. A screen that
 * speaks with one voice - only files (the songs page, an album), or only one
 * platform's songs (that platform's own list) - never prints anything, because
 * the page title and the "结果来自" line already answer it. A screen that mixes
 * origins (a playlist, the queue) prints one on every row, including the files.
 */
interface SourceTag {
  /** What the row prints: the platform's short name, or 本机. */
  label: string
  /** Origin key: a provider id, or 'local'. Used as a CSS modifier, never branched on. */
  kind: string
}

/**
 * 平台 id -> 行内标签。合并后的一行要同时列出几个平台，所以标签必须能按 id
 * 取，而不只是按「这首歌当前属于谁」取。
 *
 * 未注册的 id 原样返回：那是旧版本存下的曲目或还没接的平台，原样显示比谎称
 * 「本机」诚实。
 */
export function sourceLabelById(source: string | undefined): string {
  if (!source || source === 'local') return '本机'
  const provider = getProvider(source as ProviderId)
  return provider?.shortName ?? provider?.displayName ?? source
}

export function sourceTagFor(
  track: Track | null | undefined,
  listIsMixed: boolean
): SourceTag | null {
  if (!track || !listIsMixed) return null
  const label = sourceLabelFor(track)
  const source = track?.source
  const online = Boolean(source) && source !== 'local'
  if (online) {
    // A provider that is registered always names itself; one that is not (a track
    // saved by a build that had it, an id from a future platform) still prints
    // its own id rather than claiming to be a local file.
    return { label: label ?? (source as string), kind: source as string }
  }
  return { label: '本机', kind: 'local' }
}

