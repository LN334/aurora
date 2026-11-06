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
 * The remembered source when this build still offers it, otherwise the first
 * platform, otherwise local.
 */
export function chooseInitialSource(tabs: readonly SourceTab[], remembered: string | null): string {
  if (remembered && tabs.some((tab) => tab.id === remembered)) return remembered
  return tabs.find((tab) => tab.remote)?.id ?? 'local'
}
