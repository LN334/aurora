import { create } from 'zustand'
import { searchLocalTracks } from '../../features/library/search'
import { getProvider, listAvailableProviders } from '../../features/online/registry'
import { mergeVersions } from '../../features/online/unify'
import { sourceOrder } from '../../features/settings/source-order'
import type { Track } from '../../types'
import { chooseInitialSource } from './initial-source'
import { readRememberedSource, rememberSource, type SearchSource } from './remembered-source'

/**
 * The search screen's state, and the one place that decides what "search" means.
 *
 * One query, an explicit source tab, and results per source - the model the
 * reference player uses. What changed with the provider layer is where the tabs come
 * from: `sources()` reads the registry, so a build with two platforms offers three
 * tabs and a build with one offers two, with no list to keep in sync.
 *
 * Why a store rather than component state: the query has to survive leaving the
 * screen (the field in the title bar owns the text) and coming back, and online
 * results have to survive a re-render triggered by a local keystroke.
 *
 * The remembered source lives in `./remembered-source`, which has no bundler-only
 * imports and is therefore testable; nothing that touches a platform client can be
 * loaded outside Vite.
 */
export type { SearchSource }

 interface SearchSourceTab {
  id: SearchSource
  label: string
  /** One line describing what this source is, shown with the tab. */
  note: string
  /** True for a remote catalogue, which is the one that needs a submit. */
  remote: boolean
}

/**
 * The tabs to show.
 *
 * A function of the registry rather than a constant: a platform that is not usable
 * in this build must not offer a tab that cannot answer. Local comes first because
 * it is the one that always works and needs no network.
 */
export function searchSources(): SearchSourceTab[] {
  const tabs: SearchSourceTab[] = [
    { id: 'local', label: '本机曲库', note: '只搜这台电脑上已有的文件', remote: false }
  ]
  const platforms = listAvailableProviders().filter((provider) => provider.search)
  /*
   * 「全部平台」只在真的有两个以上在线平台时出现。
   *
   * 它的意义是合并重复：同一首歌在两家都有时，只出一行、行上标两个平台。
   * 只有一个平台时这个 tab 等于另一个 tab 的复制品，多一个只会让人犹豫。
   */
  if (platforms.length > 1) {
    tabs.push({
      id: 'all',
      label: '全部平台',
      note: '同时搜所有平台，重复的合成一行',
      remote: true
    })
  }
  for (const provider of platforms) {
    tabs.push({
      id: provider.id,
      label: provider.displayName,
      note: `联网搜索${provider.displayName}的曲库`,
      remote: true
    })
  }
  return tabs
}

interface SearchState {
  query: string
  source: SearchSource
  /** True while a remote request is in flight. */
  searching: boolean
  /** Results as of the last submit, per source. */
  results: Record<SearchSource, Track[]>
  /** Set when the last remote request failed, so the screen can say so. */
  error: string | null
  /** Whether the current query has been submitted for the active source. */
  submitted: boolean
  /**
   * False until the source has been chosen against the live registry.
   *
   * See `resolveSource`: the choice cannot be made while this module is being
   * evaluated, so it is made on first use instead.
   */
  sourceResolved: boolean

  /** Pick the remembered or default source, once, against the live registry. */
  resolveSource(): void
  setQuery(query: string): void
  setSource(source: SearchSource): void
  /** Run the query for whichever source is active. */
  submit(tracks: Track[]): Promise<void>
  clear(): void
}

export const useSearch = create<SearchState>((set, get) => ({
  query: '',
  /*
   * Not resolved here on purpose.
   *
   * This used to call the registry during store creation, which reads better than it
   * behaves: the platforms register themselves when their module runs, and whether
   * that has happened by the time this store is first imported is decided by import
   * order, not by intent. The observable symptom was a fresh install opening the
   * search screen on "本机曲库" while the code below claims the first platform is the
   * default - local wins only because the registry still looked empty. Choosing on
   * first use makes the answer depend on the registry as it actually is, and keeps
   * the documented default honest.
   */
  source: 'local',
  sourceResolved: false,
  searching: false,
  results: {},
  error: null,
  submitted: false,

  setQuery(query) {
    /*
     * Local results follow the text as it is typed; remote results do not.
     * Filtering a list already in memory costs nothing and needs no commit, while a
     * request per keystroke would be both slow and rude to the upstream. So the
     * field is live for one kind of source and explicit for the other, and
     * `submitted` records whether the remote answer belongs to the text on screen.
     */
    set({ query, submitted: false })
  },

  resolveSource() {
    if (get().sourceResolved) return
    const tabs = searchSources()
    // Whatever was used last, or the first platform on a first visit. A remembered
    // platform this build cannot serve falls back rather than leaving the screen
    // pointed at a tab that is not drawn.
    const remembered = readRememberedSource(tabs.map((tab) => tab.id))
    set({
      source: chooseInitialSource(tabs, remembered) as SearchSource,
      sourceResolved: true
    })
  },

  setSource(source) {
    // Persisted because the choice is a preference, not a per-visit decision:
    // whoever searches one catalogue nearly always wants that same one next time.
    rememberSource(source)
    set({ source, sourceResolved: true, submitted: false })
  },

  async submit(tracks) {
    // A submit from the title bar can be the first thing that asks what "search"
    // means, and there may be no screen mounted yet to do it.
    get().resolveSource()
    const { query, source } = get()
    const trimmed = query.trim()

    if (source === 'local') {
      set((state) => ({
        results: { ...state.results, local: searchLocalTracks(tracks, trimmed) },
        submitted: true,
        error: null
      }))
      return
    }

    if (!trimmed) {
      set((state) => ({ results: { ...state.results, [source]: [] }, submitted: true, error: null }))
      return
    }

    /*
     * 全部平台：并发问每一家，再把重复的合成一行。
     *
     * 一家失败不影响其它几家——结果是「能问到的那几家」，并且只有全都没答上
     * 来时才算这次搜索失败。合并按用户设定的音源顺序决定主行，所以同一首歌
     * 会以他偏好的那个平台出现在第一列。
     */
    if (source === 'all') {
      const platforms = listAvailableProviders().filter((item) => item.search)
      set({ searching: true, error: null })
      try {
        const collected = await Promise.all(
          platforms.map(async (item) => {
            const backend = item.backend as {
              search(keywords: string, kind: 'song', limit: number): Promise<{ songs: unknown[] }>
              toTrack(song: never): Track
            }
            try {
              const result = await backend.search(trimmed, 'song', 30)
              return result.songs.map((song) => backend.toTrack(song as never))
            } catch {
              return [] as Track[]
            }
          })
        )
        const tracks = collected.flat()
        set((state) => ({
          results: { ...state.results, all: mergeVersions(tracks, sourceOrder()) },
          searching: false,
          submitted: true,
          error: tracks.length === 0 ? `没有平台返回「${trimmed}」的结果` : null
        }))
      } catch (failure) {
        set({
          searching: false,
          submitted: true,
          error: failure instanceof Error ? failure.message : String(failure)
        })
      }
      return
    }

    const provider = getProvider(source)
    if (!provider?.search || !provider.available()) {
      set({
        searching: false,
        submitted: true,
        error: `${provider?.displayName ?? source}在这个构建里不可用`
      })
      return
    }

    set({ searching: true, error: null })
    try {
      /*
       * The platform's own client does the request, through its backend.
       *
       * Reusing the backend rather than calling the bridge here is what keeps one
       * implementation of "search a platform": the song -> track mapping (and
       * therefore the id prefix) stays the platform's business, and this screen
       * never learns which fields an upstream returns.
       */
      const backend = provider.backend as {
        search(keywords: string, kind: 'song', limit: number): Promise<{ songs: unknown[] }>
        toTrack(song: never): Track
      }

      const result = await backend.search(trimmed, 'song', 50)
      set((state) => ({
        results: { ...state.results, [source]: result.songs.map((song) => backend.toTrack(song as never)) },
        searching: false,
        submitted: true,
        error: null
      }))
    } catch (failure) {
      set({
        searching: false,
        submitted: true,
        error: failure instanceof Error ? failure.message : String(failure)
      })
    }
  },

  clear() {
    set({ query: '', results: {}, submitted: false, error: null })
  }
}))



/** The rows to show for the active source. */
export function searchResultsFor(state: Pick<SearchState, 'source' | 'results'>): Track[] {
  return state.results[state.source] ?? []
}
