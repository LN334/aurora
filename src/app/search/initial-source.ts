/**
 * Which catalogue a search starts on.
 *
 * Kept out of `store.ts` because that module can only be loaded through the
 * bundler, and this rule is worth pinning in a test: the store used to ask the
 * registry while its own module was being evaluated, before the platforms register
 * themselves, so a fresh install opened on the local catalogue no matter what the
 * code claimed. Nothing here touches the registry - the caller passes the tabs it
 * has right now, which is the whole point.
 */

export interface SourceTab {
  id: string
  /** True for a remote catalogue, which is the one worth defaulting to. */
  remote: boolean
}

/**
 * The remembered source when this build still offers it, otherwise the combined
 * "all platforms" tab, otherwise the first platform, otherwise local.
 *
 * Combined search is the default whenever there is more than one platform: the
 * whole point of this app is that the same song exists on two services, and
 * picking one service up front silently hides the other copy. A one-platform
 * build has no combined tab, so it still opens on that platform.
 */
export function chooseInitialSource(tabs: readonly SourceTab[], remembered: string | null): string {
  if (remembered && tabs.some((tab) => tab.id === remembered)) return remembered
  if (tabs.some((tab) => tab.id === ALL_SOURCES)) return ALL_SOURCES
  return tabs.find((tab) => tab.remote)?.id ?? 'local'
}

/** The pseudo-source that searches every platform at once. */
export const ALL_SOURCES = 'all'
